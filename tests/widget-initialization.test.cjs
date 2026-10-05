const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const filename = path.join(__dirname, '..', 'extension.js');
const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .+;\r?$/gm, '')
    .replace('export default class FinancialMarketsExtension', 'class FinancialMarketsExtension');

function fixture({
    language = 'en',
    primaryIndex = 0,
    monitors = [{x: 100, y: 200}],
    left = 15,
    top = 25,
    duration = 10,
} = {}) {
    const values = {language, left, top, duration};
    const calls = [];
    const settingsSignals = new Map();
    const monitorSignals = new Map();
    const settings = {
        get_int: key => values[key],
        connect(name, callback) {
            assert.equal(name, 'changed');
            calls.push('connect-settings');
            settingsSignals.set(41, callback);
            return 41;
        },
    };
    const layoutManager = {
        primaryIndex,
        monitors,
        _backgroundGroup: {
            add_child(widget) {
                calls.push('attach');
                assert.equal(widget, context.widget);
            },
        },
        connect(name, callback) {
            assert.equal(name, 'monitors-changed');
            calls.push('connect-monitors');
            monitorSignals.set(73, callback);
            return 73;
        },
    };
    const context = vm.createContext({
        Gio: {_promisify() {}, Subprocess: class {}},
        GObject: {registerClass: klass => klass},
        St: {
            BoxLayout: class {
                _init(params) {
                    this.actorParams = params;
                    calls.push('actor-init');
                }
                set_position(x, y) {
                    this.position = [x, y];
                    calls.push('position');
                }
            },
        },
        Main: {layoutManager},
        Extension: class {},
        translator(received) {
            assert.equal(received, settings);
            calls.push('translate');
            const vi = values.language === 'vi';
            return (en, vietnamese) => vi ? vietnamese : en;
        },
    });
    vm.runInContext(`${source}\nglobalThis.Widget = StocksWidget;`, context, {filename});
    const widget = Object.create(context.Widget.prototype);
    context.widget = widget;
    Object.assign(widget, {
        _buildUi() {
            calls.push('build-ui');
            this._title = {text: 'old title'};
            this._updated = {text: 'old timestamp'};
        },
        _refresh() {
            calls.push('refresh');
            this.refreshState = {
                generation: this._generation,
                failures: this._failureCount,
                title: this._title.text,
                updated: this._updated.text,
            };
            return Promise.resolve();
        },
        _renderRows(rows) {
            calls.push('render');
            this.rows = Array.from(rows);
        },
        _showError(message) {
            calls.push('error');
            this.error = message;
        },
    });
    const extension = {
        getSettings() {
            calls.push('get-settings');
            return settings;
        },
    };
    widget._init(extension);
    let cancellations = 0;
    widget._runner.cancel = () => {
        cancellations++;
        calls.push('cancel');
    };
    return {
        widget, extension, values, calls, settings, layoutManager,
        settingsSignals, monitorSignals,
        cancellations: () => cancellations,
        change(key, value) {
            values[key] = value;
            settingsSignals.get(41)(settings, key);
        },
        monitorsChanged() {
            monitorSignals.get(73)();
        },
    };
}

test('initialization builds and positions before attaching and refreshing', () => {
    const f = fixture();
    assert.deepEqual(f.calls, [
        'actor-init', 'get-settings', 'translate', 'build-ui', 'position',
        'attach', 'connect-monitors', 'connect-settings', 'refresh',
    ]);
    assert.equal(f.widget._extension, f.extension);
    assert.equal(f.widget._settings, f.settings);
    assert.deepEqual(JSON.parse(JSON.stringify(f.widget.actorParams)), {
        vertical: true, style_class: 'stocks-card', reactive: false, can_focus: false,
    });
    assert.equal(f.widget._settingsId, 41);
    assert.equal(f.widget._monitorsChangedId, 73);
    assert.equal(f.widget._generation, 0);
    assert.equal(f.widget._failureCount, 0);
});

for (const primaryIndex of [0, 1, -1, null, undefined]) {
    test(`position uses primary monitor or zero fallback: ${primaryIndex}`, () => {
        const f = fixture({monitors: [{x: -100, y: 200}, {x: 800, y: -50}]});
        f.layoutManager.primaryIndex = primaryIndex;
        f.widget._updatePosition();
        const expected = primaryIndex === 1 ? [815, -25] : [-85, 225];
        assert.deepEqual(f.widget.position, expected);
    });
}

test('missing monitor leaves position unchanged', () => {
    const f = fixture({primaryIndex: 4});
    assert.equal(f.widget.position, undefined);
    f.widget.position = [9, 8];
    f.layoutManager.monitors = [];
    f.monitorsChanged();
    assert.deepEqual(f.widget.position, [9, 8]);
});

test('monitor changes read current geometry and offsets without refreshing', () => {
    const f = fixture();
    f.calls.length = 0;
    f.layoutManager.monitors = [{x: -900, y: -200}];
    f.values.left = 30;
    f.values.top = 40;
    f.monitorsChanged();
    assert.deepEqual(f.widget.position, [-870, -160]);
    assert.deepEqual(f.calls, ['position']);
    assert.equal(f.cancellations(), 0);
});

for (const [key, expected] of [['left', [160, 225]], ['top', [115, 260]]]) {
    test(`${key} changes only reposition, preserving generation and backoff`, () => {
        const f = fixture();
        f.widget._generation = 6;
        f.widget._failureCount = 3;
        f.calls.length = 0;
        f.change(key, 60);
        assert.deepEqual(f.widget.position, expected);
        assert.deepEqual(f.calls, ['position']);
        assert.equal(f.widget._generation, 6);
        assert.equal(f.widget._failureCount, 3);
        assert.equal(f.cancellations(), 0);
    });
}

for (const duration of [5, 10, 300]) {
    test(`interval converts current ${duration} minute setting to milliseconds`, () => {
        const f = fixture();
        f.values.duration = duration;
        assert.equal(f.widget._intervalMs, duration * 60 * 1000);
    });
}

for (const key of ['duration', 'other-setting']) {
    test(`${key} changes invalidate pending data and reset backoff before refresh`, () => {
        const f = fixture();
        f.widget._generation = 4;
        f.widget._failureCount = 7;
        f.calls.length = 0;
        f.change(key, 20);
        assert.deepEqual(f.calls, ['cancel', 'refresh']);
        assert.equal(f.cancellations(), 1);
        assert.deepEqual(f.widget.refreshState, {
            generation: 5, failures: 0, title: 'old title', updated: 'old timestamp',
        });
        assert.equal(f.widget._intervalMs, (key === 'duration' ? 20 : 10) * 60000);
    });
}

test('symbols changes clear stale rows, timestamp and warning before refresh', () => {
    const f = fixture();
    f.widget._failureCount = 5;
    f.calls.length = 0;
    f.change('symbols', ['MSFT']);
    assert.deepEqual(f.calls, ['cancel', 'render', 'error', 'refresh']);
    assert.deepEqual(f.widget.rows, []);
    assert.equal(f.widget.error, null);
    assert.equal(f.widget._title.text, 'old title');
    assert.deepEqual(f.widget.refreshState, {
        generation: 1, failures: 0, title: 'old title', updated: 'Updated: --:--',
    });
});

for (const language of ['en', 'vi']) {
    test(`language changes rebuild translator and number formatters: ${language}`, () => {
        const f = fixture({language: language === 'en' ? 'vi' : 'en'});
        const oldTranslator = f.widget._t;
        const oldFormatters = f.widget._formatters;
        f.widget._failureCount = 4;
        f.calls.length = 0;
        f.change('language', language);
        assert.deepEqual(f.calls, ['cancel', 'translate', 'render', 'error', 'refresh']);
        assert.notEqual(f.widget._t, oldTranslator);
        assert.notEqual(f.widget._formatters, oldFormatters);
        const locale = language === 'vi' ? 'vi-VN' : 'en-US';
        for (const [index, digits] of [[0, 0], [1, 2]]) {
            const options = f.widget._formatters[index].resolvedOptions();
            assert.equal(options.locale, locale);
            assert.equal(options.minimumFractionDigits, digits);
            assert.equal(options.maximumFractionDigits, digits);
        }
        assert.deepEqual(f.widget.rows, []);
        assert.equal(f.widget.error, null);
        assert.deepEqual(f.widget.refreshState, {
            generation: 1,
            failures: 0,
            title: language === 'vi' ? 'THỊ TRƯỜNG TÀI CHÍNH' : 'FINANCIAL MARKETS',
            updated: language === 'vi' ? 'Cập nhật: --:--' : 'Updated: --:--',
        });
    });
}

test('successive data-setting changes each invalidate and cancel before refresh', () => {
    const f = fixture();
    f.calls.length = 0;
    f.change('duration', 15);
    f.change('symbols', ['AAPL']);
    f.change('language', 'vi');
    assert.equal(f.widget._generation, 3);
    assert.equal(f.cancellations(), 3);
    assert.equal(f.calls.filter(call => call === 'refresh').length, 3);
    assert.equal(f.widget.refreshState.generation, 3);
});
