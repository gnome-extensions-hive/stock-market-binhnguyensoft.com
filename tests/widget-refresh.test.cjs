const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8')
    .replace(/^import .+;\r?$/gm, '')
    .replace('export default class FinancialMarketsExtension', 'class FinancialMarketsExtension');

function fixture({symbols = ['AAPL'], duration = 10} = {}) {
    let nextId = 1;
    const timers = new Map();
    const removed = [];
    const errors = [];
    const disconnected = [];
    const monitorDisconnected = [];
    let actorDestroyed = 0;
    const context = vm.createContext({
        Gio: {
            _promisify() {},
            Subprocess: class {},
            IOErrorEnum: {CANCELLED: 19},
        },
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            build_filenamev: parts => parts.join('/'),
            DateTime: {
                new_from_unix_local: seconds => ({
                    format: pattern => {
                        assert.equal(seconds, 1700000000);
                        assert.equal(pattern, '%H:%M');
                        return '22:13';
                    },
                }),
            },
            timeout_add: (priority, delay, callback) => {
                assert.equal(priority, 0);
                const id = nextId++;
                timers.set(id, {delay, callback});
                return id;
            },
            Source: {
                remove: id => {
                    assert.ok(timers.delete(id), `unknown timer ${id}`);
                    removed.push(id);
                },
            },
        },
        GObject: {registerClass: cls => cls},
        St: {BoxLayout: class {destroy() { actorDestroyed++; }}},
        Main: {layoutManager: {disconnect: id => monitorDisconnected.push(id)}},
        Extension: class {},
        console: {error: message => errors.push(message)},
    });
    vm.runInContext(`${source}\nglobalThis.Widget = StocksWidget;`, context, {
        filename: path.join(__dirname, '..', 'extension.js'),
    });
    const widget = Object.create(context.Widget.prototype);
    const calls = [];
    const runner = {
        running: false,
        destroyed: 0,
        run: async argv => {
            calls.push(Array.from(argv));
            return response();
        },
        destroy() { this.destroyed++; },
    };
    Object.assign(widget, {
        _settings: {
            get_strv: key => {
                assert.equal(key, 'symbols');
                return symbols;
            },
            get_int: key => {
                assert.equal(key, 'duration');
                return duration;
            },
            disconnect: id => disconnected.push(id),
        },
        _extension: {path: '/extension'},
        _t: english => english,
        _generation: 0,
        _runner: runner,
        _refreshSourceId: 0,
        _failureCount: 0,
        _destroyed: false,
        _settingsId: 12,
        _monitorsChangedId: 34,
        _updated: {text: 'last update'},
        rows: [{symbol: 'OLD', price: 10}],
        error: 'old error',
        _renderRows(rows) { this.rows = JSON.parse(JSON.stringify(rows)); },
        _showError(message) { this.error = message; },
    });
    return {
        widget, runner, calls, timers, removed, errors, disconnected,
        monitorDisconnected, actorDestroyed: () => actorDestroyed,
    };
}

function response(data = {}) {
    return {
        stdout: JSON.stringify({
            rows: [{symbol: 'AAPL', price: 123, change: 2, changePercent: 1.5}],
            liveCount: 1,
            updatedAt: 1700000000,
            ...data,
        }),
        stderr: '',
        successful: true,
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return {promise, resolve, reject};
}

function delay(f) {
    assert.equal(f.timers.size, 1);
    assert.ok(f.timers.has(f.widget._refreshSourceId));
    return f.timers.get(f.widget._refreshSourceId).delay;
}

test('live refresh renders validated rows, clears errors and resets backoff', async () => {
    const f = fixture();
    f.widget._failureCount = 4;
    await f.widget._refresh();
    assert.deepEqual(f.calls, [['python3', '-B', '/extension/stocks_fetch.py', '["AAPL"]']]);
    assert.deepEqual(f.widget.rows, [{symbol: 'AAPL', price: 123, change: 2, changePercent: 1.5}]);
    assert.equal(f.widget._updated.text, 'Updated: 22:13');
    assert.equal(f.widget.error, null);
    assert.equal(f.widget._failureCount, 0);
    assert.equal(delay(f), 600000);
    assert.deepEqual(f.errors, []);
});

test('partial live data warns but schedules the normal interval', async () => {
    const f = fixture();
    f.runner.run = async () => response({warning: 'partial'});
    await f.widget._refresh();
    assert.equal(f.widget.error, 'Some symbols could not be updated.');
    assert.equal(delay(f), 600000);
    assert.equal(f.widget._failureCount, 0);
});

test('cached rows without live data remain visible and increase backoff', async () => {
    const f = fixture();
    f.widget._failureCount = 1;
    f.runner.run = async () => response({liveCount: 0, fromCache: true, warning: 'offline'});
    await f.widget._refresh();
    assert.equal(f.widget.rows[0].symbol, 'AAPL');
    assert.equal(f.widget.error, 'Update failed; showing cached prices.');
    assert.equal(f.widget._failureCount, 2);
    assert.equal(delay(f), 1200000);
});

test('non-cached rows without live data show retry warning and back off', async () => {
    const f = fixture();
    f.runner.run = async () => response({liveCount: 0, warning: 'unavailable'});
    await f.widget._refresh();
    assert.equal(f.widget.error, 'No Yahoo data yet; retrying automatically.');
    assert.equal(f.widget._failureCount, 1);
    assert.equal(delay(f), 600000);
});

test('empty payload resets failures and retries at the normal interval', async () => {
    const f = fixture();
    f.widget._failureCount = 5;
    f.runner.run = async () => response({rows: [], liveCount: 0, updatedAt: null});
    await f.widget._refresh();
    assert.deepEqual(f.widget.rows, []);
    assert.equal(f.widget._updated.text, 'Updated: --:--');
    assert.equal(f.widget._failureCount, 0);
    assert.equal(delay(f), 600000);
});

test('absent liveCount falls back to validated row count', async () => {
    const f = fixture();
    f.runner.run = async () => response({liveCount: undefined});
    await f.widget._refresh();
    assert.equal(f.widget._failureCount, 0);
    assert.equal(delay(f), 600000);
});

test('empty watchlist clears display and an existing timer without spawning', async () => {
    const f = fixture({symbols: []});
    f.widget._scheduleNext(123);
    const id = f.widget._refreshSourceId;
    await f.widget._refresh();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.widget.rows, []);
    assert.equal(f.widget.error, null);
    assert.equal(f.widget._updated.text, 'Updated: --:--');
    assert.deepEqual(f.removed, [id]);
    assert.equal(f.timers.size, 0);
    assert.equal(f.widget._refreshSourceId, 0);
});

for (const state of ['destroyed', 'running']) {
    test(`refresh is inert while ${state}`, async () => {
        const f = fixture();
        f.widget._scheduleNext(123);
        if (state === 'destroyed')
            f.widget._destroyed = true;
        else
            f.runner.running = true;
        await f.widget._refresh();
        assert.deepEqual(f.calls, []);
        assert.equal(delay(f), 123);
        assert.equal(f.widget.rows[0].symbol, 'OLD');
    });
}

const failures = [
    ['malformed JSON', {stdout: 'not JSON', stderr: '', successful: true}],
    ['empty stdout with stderr', {stdout: ' ', stderr: 'network down', successful: false}],
    ['reported payload error', response({error: 'provider error'})],
    ['failed subprocess', {...response(), successful: false, stderr: 'exit failure'}],
    ['missing rows', response({rows: undefined})],
    ['non-object payload', {stdout: '[]', stderr: '', successful: true}],
    ['invalid row', response({rows: [null]})],
    ['too many rows', response({rows: Array.from({length: 21}, () => ({symbol: 'AAPL'}))})],
];
for (const [name, result] of failures) {
    test(`${name} preserves last valid rows and timestamp, logs, and retries`, async () => {
        const f = fixture();
        f.runner.run = async () => result;
        await f.widget._refresh();
        assert.deepEqual(f.widget.rows, [{symbol: 'OLD', price: 10}]);
        assert.equal(f.widget._updated.text, 'last update');
        assert.equal(f.widget.error, 'Could not update prices. Will retry automatically.');
        assert.equal(f.errors.length, 1);
        assert.match(f.errors[0], /stock-market@binhnguyensoft\.com: refresh failed:/);
        assert.equal(f.widget._failureCount, 1);
        assert.equal(delay(f), 600000);
    });
}

test('rejected subprocess communication preserves rows and schedules backoff', async () => {
    const f = fixture();
    f.runner.run = async () => { throw new Error('communication failed'); };
    await f.widget._refresh();
    assert.equal(f.widget.rows[0].symbol, 'OLD');
    assert.match(f.errors[0], /communication failed/);
    assert.equal(delay(f), 600000);
});

for (const error of [
    new Error('__STOCKS_CANCELLED__'),
    {message: 'cancelled', matches: (domain, code) => code === domain.CANCELLED},
]) {
    test(`cancellation ${error.message} does not log or schedule retries`, async () => {
        const f = fixture();
        f.runner.run = async () => { throw error; };
        await f.widget._refresh();
        assert.equal(f.widget.rows[0].symbol, 'OLD');
        assert.equal(f.widget.error, 'old error');
        assert.equal(f.widget._failureCount, 0);
        assert.deepEqual(f.errors, []);
        assert.equal(f.timers.size, 0);
    });
}

for (const outcome of ['resolve', 'reject']) {
    test(`stale generation ${outcome} cannot alter display or newer timer`, async () => {
        const f = fixture();
        const pending = deferred();
        f.runner.run = () => pending.promise;
        const refresh = f.widget._refresh();
        f.widget._generation++;
        f.widget._scheduleNext(321);
        if (outcome === 'resolve')
            pending.resolve(response());
        else
            pending.reject(new Error('old failure'));
        await refresh;
        assert.equal(f.widget.rows[0].symbol, 'OLD');
        assert.equal(f.widget._updated.text, 'last update');
        assert.equal(f.widget.error, 'old error');
        assert.deepEqual(f.errors, []);
        assert.equal(delay(f), 321);
    });
}

test('failure delays double, cap at one hour, and saturate the failure counter', () => {
    const f = fixture();
    const delays = [];
    for (let i = 0; i < 10; i++) {
        f.widget._scheduleFailure();
        delays.push(delay(f));
    }
    assert.deepEqual(delays, [600000, 1200000, 2400000, 3600000, 3600000,
        3600000, 3600000, 3600000, 3600000, 3600000]);
    assert.equal(f.widget._failureCount, 8);
    assert.equal(f.removed.length, 9);
});

test('backoff never shortens a configured interval above one hour', () => {
    const f = fixture({duration: 300});
    for (let i = 0; i < 3; i++) {
        f.widget._scheduleFailure();
        assert.equal(delay(f), 18000000);
    }
});

test('scheduled callback clears its ID before refresh and removes itself', () => {
    const f = fixture();
    let refreshed = 0;
    f.widget._refresh = () => {
        assert.equal(f.widget._refreshSourceId, 0);
        refreshed++;
    };
    f.widget._scheduleNext(123);
    const id = f.widget._refreshSourceId;
    const timer = f.timers.get(id);
    f.timers.delete(id);
    assert.equal(timer.callback(), false);
    assert.equal(refreshed, 1);
});

for (const outcome of ['resolve', 'reject']) {
    test(`destroy cleans up exactly once and suppresses pending ${outcome}`, async () => {
        const f = fixture();
        const pending = deferred();
        f.runner.run = () => pending.promise;
        const refresh = f.widget._refresh();
        f.widget._scheduleNext(123);
        const timerId = f.widget._refreshSourceId;
        f.widget.destroy();
        f.widget.destroy();
        if (outcome === 'resolve')
            pending.resolve(response());
        else
            pending.reject(new Error('late failure'));
        await refresh;
        assert.equal(f.runner.destroyed, 1);
        assert.equal(f.widget._runner, null);
        assert.equal(f.widget._generation, 1);
        assert.deepEqual(f.disconnected, [12]);
        assert.deepEqual(f.monitorDisconnected, [34]);
        assert.deepEqual(f.removed, [timerId]);
        assert.equal(f.widget._settingsId, 0);
        assert.equal(f.widget._monitorsChangedId, 0);
        assert.equal(f.widget._refreshSourceId, 0);
        assert.equal(f.actorDestroyed(), 1);
        assert.equal(f.widget.rows[0].symbol, 'OLD');
        assert.equal(f.widget.error, 'old error');
        assert.equal(f.timers.size, 0);
        assert.deepEqual(f.errors, []);
        f.widget._scheduleNext(123);
        await f.widget._refresh();
        assert.equal(f.timers.size, 0);
    });
}
