const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8')
    .replace(/^import .+;\r?$/gm, '')
    .replace('export default class FinancialMarketsExtension', 'class FinancialMarketsExtension');

function fixture(code = source) {
    const processes = [];
    const timers = new Map();
    const removed = [];
    const promisified = [];
    let nextTimer = 1;
    let spawnError = null;

    class Cancellable {
        constructor() {
            this.cancelCount = 0;
        }

        cancel() {
            this.cancelCount++;
        }
    }

    const Gio = {
        Cancellable,
        SubprocessFlags: {STDOUT_PIPE: 1, STDERR_PIPE: 2},
        Subprocess: {
            prototype: {},
            new(argv, flags) {
                if (spawnError)
                    throw spawnError;
                let resolve;
                let reject;
                const pending = new Promise((yes, no) => {
                    resolve = yes;
                    reject = no;
                });
                const proc = {
                    argv,
                    flags,
                    resolve,
                    reject,
                    exitCount: 0,
                    successful: true,
                    forceExitError: null,
                    statusError: null,
                    communicate_utf8_async(input, cancellable) {
                        this.input = input;
                        this.cancellable = cancellable;
                        return pending;
                    },
                    force_exit() {
                        this.exitCount++;
                        if (this.forceExitError)
                            throw this.forceExitError;
                    },
                    get_successful() {
                        if (this.statusError)
                            throw this.statusError;
                        return this.successful;
                    },
                };
                processes.push(proc);
                return proc;
            },
        },
        _promisify(...args) {
            promisified.push(args);
        },
    };
    const context = vm.createContext({
        Gio,
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            timeout_add(priority, delay, callback) {
                const id = nextTimer++;
                timers.set(id, {priority, delay, callback});
                return id;
            },
            Source: {
                remove(id) {
                    assert.ok(timers.delete(id), `unknown timer ${id}`);
                    removed.push(id);
                },
            },
        },
        GObject: {registerClass: cls => cls},
        St: {BoxLayout: class {}},
        Extension: class {},
    });
    vm.runInContext(`${code}\nglobalThis.Runner = SafeCommandRunner;`, context, {
        filename: 'extension.js',
    });
    return {
        runner: new context.Runner(),
        processes,
        timers,
        removed,
        promisified,
        Gio,
        setSpawnError(error) {
            spawnError = error;
        },
        fire(id) {
            const timer = timers.get(id);
            assert.ok(timer, `unknown timer ${id}`);
            timers.delete(id);
            return timer.callback();
        },
    };
}

function assertIdle(f) {
    assert.equal(f.runner.running, false);
    assert.equal(f.runner._proc, null);
    assert.equal(f.runner._cancellable, null);
    assert.equal(f.runner._timeoutId, 0);
    assert.equal(f.timers.size, 0);
}

test('initial state is idle and communication is promisified', () => {
    const f = fixture();
    assertIdle(f);
    assert.equal(f.runner._destroyed, false);
    assert.equal(f.runner._serial, 0);
    assert.equal(f.promisified.length, 1);
    assert.equal(f.promisified[0][0], f.Gio.Subprocess.prototype);
    assert.equal(f.promisified[0][1], 'communicate_utf8_async');
});

test('run forwards argv, captures both pipes and schedules a 20-second timeout', async () => {
    const f = fixture();
    const argv = ['python3', '-B', '/path with spaces/stocks_fetch.py', '["BTC-USD"]'];
    const pending = f.runner.run(argv);
    const proc = f.processes[0];
    assert.equal(proc.argv, argv);
    assert.equal(proc.flags, 3);
    assert.equal(proc.input, null);
    assert.equal(proc.cancellable, f.runner._cancellable);
    assert.equal(f.runner.running, true);
    assert.equal(f.timers.size, 1);
    assert.equal(f.timers.get(f.runner._timeoutId).delay, 20000);
    assert.equal(f.timers.get(f.runner._timeoutId).priority, 0);
    proc.resolve(['quotes', 'warning']);
    const result = await pending;
    assert.equal(result.stdout, 'quotes');
    assert.equal(result.stderr, 'warning');
    assert.equal(result.successful, true);
    assert.equal(proc.exitCount, 0);
    assert.equal(proc.cancellable.cancelCount, 0);
    assert.equal(f.removed.length, 1);
    assertIdle(f);
});

for (const empty of [null, undefined]) {
    test(`nullish output ${empty} becomes empty strings`, async () => {
        const f = fixture();
        const pending = f.runner.run(['fetch']);
        f.processes[0].resolve([empty, empty]);
        const result = await pending;
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, '');
        assertIdle(f);
    });
}

test('nonzero exit status is returned to the caller rather than thrown', async () => {
    const f = fixture();
    const pending = f.runner.run(['fetch']);
    f.processes[0].successful = false;
    f.processes[0].resolve(['partial', 'failed']);
    assert.equal((await pending).successful, false);
    assertIdle(f);
});

for (const stream of [0, 1]) {
    for (const excess of [0, 1]) {
        test(`stream ${stream} ${excess ? 'rejects above' : 'accepts at'} 2 MiB character limit`, async () => {
            const f = fixture();
            const pending = f.runner.run(['fetch']);
            const output = ['', ''];
            output[stream] = 'x'.repeat(2 * 1024 * 1024 + excess);
            f.processes[0].resolve(output);
            if (excess)
                await assert.rejects(pending, /Output/);
            else
                assert.equal((await pending)[stream === 0 ? 'stdout' : 'stderr'].length, output[stream].length);
            assertIdle(f);
        });
    }
}

test('communication failure preserves error identity and cleans up', async () => {
    const f = fixture();
    const error = new Error('communication failed');
    const pending = f.runner.run(['fetch']);
    f.processes[0].reject(error);
    await assert.rejects(pending, actual => actual === error);
    assertIdle(f);
});

test('status lookup failure preserves error identity and cleans up', async () => {
    const f = fixture();
    const error = new Error('status failed');
    const pending = f.runner.run(['fetch']);
    f.processes[0].statusError = error;
    f.processes[0].resolve(['', '']);
    await assert.rejects(pending, actual => actual === error);
    assertIdle(f);
});

test('spawn failure leaves no timer or active process and permits retry', async () => {
    const f = fixture();
    const error = new Error('spawn failed');
    f.setSpawnError(error);
    await assert.rejects(f.runner.run(['fetch']), actual => actual === error);
    assertIdle(f);
    f.setSpawnError(null);
    const pending = f.runner.run(['retry']);
    f.processes[0].resolve(['retried', '']);
    assert.equal((await pending).stdout, 'retried');
    assertIdle(f);
});

for (const forceExitFails of [false, true]) {
    test(`timeout cancels communication and reports timeout${forceExitFails ? ' even if force_exit throws' : ''}`, async () => {
        const f = fixture();
        const pending = f.runner.run(['fetch']);
        const proc = f.processes[0];
        if (forceExitFails)
            proc.forceExitError = new Error('already exited');
        assert.equal(f.fire(f.runner._timeoutId), false);
        assert.equal(proc.cancellable.cancelCount, 1);
        assert.equal(proc.exitCount, 1);
        assert.equal(f.runner._timeoutId, 0);
        proc.reject(new Error('operation cancelled'));
        await assert.rejects(pending, /qu\u00e1 th\u1eddi gian/);
        assert.equal(f.removed.length, 0);
        assertIdle(f);
    });
}

test('cancel on an idle runner is repeatable and creates no resources', () => {
    const f = fixture();
    f.runner.cancel();
    f.runner.cancel();
    assert.equal(f.runner._serial, 2);
    assertIdle(f);
});

for (const forceExitFails of [false, true]) {
    test(`cancel removes timer and kills active process${forceExitFails ? ' despite force_exit failure' : ''}`, async () => {
        const f = fixture();
        const pending = f.runner.run(['fetch']);
        const proc = f.processes[0];
        if (forceExitFails)
            proc.forceExitError = new Error('already exited');
        f.runner.cancel();
        assert.equal(proc.cancellable.cancelCount, 1);
        assert.equal(proc.exitCount, 1);
        assert.equal(f.removed.length, 1);
        assertIdle(f);
        f.runner.cancel();
        assert.equal(proc.exitCount, 1);
        proc.resolve(['obsolete', '']);
        await assert.rejects(pending, /__STOCKS_CANCELLED__/);
        assertIdle(f);
    });
}

test('cancelled communication rejection preserves the underlying error', async () => {
    const f = fixture();
    const pending = f.runner.run(['fetch']);
    const error = new Error('Gio cancellation');
    f.runner.cancel();
    f.processes[0].reject(error);
    await assert.rejects(pending, actual => actual === error);
    assertIdle(f);
});

for (const oldFails of [false, true]) {
    test(`replacing a request isolates late ${oldFails ? 'failure' : 'success'} cleanup from new resources`, async () => {
        const f = fixture();
        const oldPending = f.runner.run(['old']);
        const oldProc = f.processes[0];
        const oldTimer = f.runner._timeoutId;
        const currentPending = f.runner.run(['current']);
        const currentProc = f.processes[1];
        const currentTimer = f.runner._timeoutId;
        assert.equal(oldProc.exitCount, 1);
        assert.equal(oldProc.cancellable.cancelCount, 1);
        assert.deepEqual(f.removed, [oldTimer]);
        const error = new Error('old request failed');
        if (oldFails)
            oldProc.reject(error);
        else
            oldProc.resolve(['obsolete', '']);
        await assert.rejects(oldPending, actual => oldFails
            ? actual === error : actual.message === '__STOCKS_CANCELLED__');
        assert.equal(f.runner.running, true);
        assert.equal(f.runner._proc, currentProc);
        assert.equal(f.runner._cancellable, currentProc.cancellable);
        assert.equal(f.runner._timeoutId, currentTimer);
        assert.ok(f.timers.has(currentTimer));
        assert.equal(currentProc.cancellable.cancelCount, 0);
        currentProc.resolve(['current', '']);
        assert.equal((await currentPending).stdout, 'current');
        assert.deepEqual(f.removed, [oldTimer, currentTimer]);
        assertIdle(f);
    });
}

test('completed requests can reuse a runner without cancelling the finished process', async () => {
    const f = fixture();
    const first = f.runner.run(['first']);
    f.processes[0].resolve(['first', '']);
    await first;
    assertIdle(f);
    const second = f.runner.run(['second']);
    assert.equal(f.processes[0].exitCount, 0);
    assert.equal(f.processes[0].cancellable.cancelCount, 0);
    f.processes[1].resolve(['second', '']);
    assert.equal((await second).stdout, 'second');
    assertIdle(f);
});

test('timeout from an older request cannot clear replacement cleanup after rejection', async () => {
    const f = fixture();
    const oldPending = f.runner.run(['old']);
    const oldProc = f.processes[0];
    f.fire(f.runner._timeoutId);
    const currentPending = f.runner.run(['current']);
    const currentProc = f.processes[1];
    const timer = f.runner._timeoutId;
    oldProc.reject(new Error('cancelled'));
    await assert.rejects(oldPending, /qu\u00e1 th\u1eddi gian/);
    assert.equal(f.runner._proc, currentProc);
    assert.equal(f.runner._timeoutId, timer);
    assert.ok(f.timers.has(timer));
    currentProc.resolve(['current', '']);
    await currentPending;
    assertIdle(f);
});

test('destroy is repeatable and prevents spawning new requests', async () => {
    const f = fixture();
    f.runner.destroy();
    f.runner.destroy();
    assert.equal(f.runner._destroyed, true);
    await assert.rejects(f.runner.run(['fetch']), /Runner/);
    assert.equal(f.processes.length, 0);
    assertIdle(f);
});

for (const lateFailure of [false, true]) {
    test(`destroy cancels active request and fences late ${lateFailure ? 'failure' : 'success'}`, async () => {
        const f = fixture();
        const pending = f.runner.run(['fetch']);
        const proc = f.processes[0];
        f.runner.destroy();
        assert.equal(proc.cancellable.cancelCount, 1);
        assert.equal(proc.exitCount, 1);
        assertIdle(f);
        const error = new Error('destroyed communication');
        if (lateFailure)
            proc.reject(error);
        else
            proc.resolve(['obsolete', '']);
        await assert.rejects(pending, actual => lateFailure
            ? actual === error : actual.message === '__STOCKS_CANCELLED__');
        await assert.rejects(f.runner.run(['retry']), /Runner/);
        assert.equal(f.processes.length, 1);
        assertIdle(f);
    });
}
