const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
const MISSING = '\u2014';

function harness(language = 'en') {
    class Actor {
        constructor(params = {}) {
            Object.assign(this, params);
            this.children = [];
            this.removed = [];
            this.clutter_text = {
                set_line_alignment(alignment) { this.alignment = alignment; },
            };
        }

        add_child(child) { this.children.push(child); }
        set_width(width) { this.width = width; }
        destroy_all_children() {
            this.removed.push(...this.children);
            this.children = [];
        }
    }

    const context = vm.createContext({
        Intl,
        Clutter: {ActorAlign: {CENTER: 'center', END: 'end'}},
        Gio: {Subprocess: class {}, _promisify() {}},
        GLib: {},
        GObject: {registerClass: klass => klass},
        Pango: {EllipsizeMode: {END: 'ellipsis-end'}, Alignment: {RIGHT: 'right'}},
        St: {Label: Actor, BoxLayout: Actor},
        Main: {},
        Extension: class {},
    });
    const adapted = SOURCE.replace(/^import .*;\r?\n/gm, '')
        .replace('export default class ', 'class ');
    vm.runInContext(`${adapted}
        globalThis.contracts = {
            numberFormatters, makeLabel, validFinite,
            formatNumber, formatSigned, formatPct, StocksWidget,
        };`, context, {filename: 'extension.js'});
    const api = context.contracts;
    const t = (en, vi) => language === 'vi' ? vi : en;
    const widget = new Actor();
    Object.setPrototypeOf(widget, api.StocksWidget.prototype);
    widget._t = t;
    widget._formatters = api.numberFormatters(t);
    widget._buildUi();
    return {api, widget, formatters: widget._formatters};
}

test('numberFormatters requests the locale and fixed zero/two digit precision', () => {
    for (const language of ['en', 'vi']) {
        const {api} = harness(language);
        const calls = [];
        const formatters = api.numberFormatters((en, vi) => {
            calls.push([en, vi]);
            return language === 'vi' ? vi : en;
        });
        assert.deepEqual(calls, [['en-US', 'vi-VN'], ['en-US', 'vi-VN']]);
        for (const [index, digits] of [0, 2].entries()) {
            const options = formatters[index].resolvedOptions();
            assert.equal(options.locale, language === 'vi' ? 'vi-VN' : 'en-US');
            assert.equal(options.minimumFractionDigits, digits);
            assert.equal(options.maximumFractionDigits, digits);
        }
    }
});

test('validFinite preserves zero, numeric coercion and inclusive limits', () => {
    const {api} = harness();
    for (const [input, expected] of [
        [0, 0], ['12.5', 12.5], ['', 0], [false, 0],
        [1e12, 1e12], [-1e12, -1e12],
    ])
        assert.equal(api.validFinite(input), expected);
    assert.equal(api.validFinite(100000, 100000), 100000);
    assert.equal(api.validFinite(-100000, 100000), -100000);
});

test('validFinite rejects missing, nonfinite and out-of-range values', () => {
    const {api} = harness();
    for (const input of [null, undefined, NaN, Infinity, -Infinity, 'bad', 1e12 + 1, -1e12 - 1])
        assert.equal(api.validFinite(input), null);
    assert.equal(api.validFinite(100001, 100000), null);
    assert.equal(api.validFinite(-100001, 100000), null);
});

test('formatNumber distinguishes Vietnamese shares from indices and other symbols', () => {
    const {api, formatters} = harness();
    for (const [symbol, expected] of [
        ['VNM.VN', '1,235'], ['^VNINDEX.VN', '1,234.56'],
        ['AAPL', '1,234.56'], ['BTC-USD', '1,234.56'],
        ['VNM.vn', '1,234.56'], [undefined, '1,234.56'],
    ])
        assert.equal(api.formatNumber(1234.56, symbol, formatters), expected);
    assert.equal(api.formatNumber(-1234.56, 'VNM.VN', formatters), '-1,235');
});

test('formatNumber renders unavailable prices as a dash', () => {
    const {api, formatters} = harness();
    for (const input of [null, undefined, NaN, Infinity, 'bad', 1e12 + 1])
        assert.equal(api.formatNumber(input, 'AAPL', formatters), MISSING);
    assert.equal(api.formatNumber(0, 'AAPL', formatters), '0.00');
});

test('formatSigned uses one sign, absolute magnitude and symbol-specific precision', () => {
    const {api, formatters} = harness();
    for (const [value, symbol, expected] of [
        [12.5, 'AAPL', '+12.50'], [-12.5, 'AAPL', '-12.50'],
        [0, 'AAPL', '+0.00'], [-0, 'AAPL', '+0.00'],
        [12.5, 'VNM.VN', '+13'], [-12.5, 'VNM.VN', '-13'],
        ['-12.5', 'AAPL', '-12.50'], [null, 'AAPL', MISSING],
        [Infinity, 'AAPL', MISSING], [1e12 + 1, 'AAPL', MISSING],
    ])
        assert.equal(api.formatSigned(value, symbol, formatters), expected);
});

test('formatPct uses a positive sign and percent suffix with inclusive safety limits', () => {
    const {api, formatters} = harness();
    for (const [value, expected] of [
        [2.5, '+2.50%'], [-2.5, '-2.50%'], [0, '+0.00%'],
        [100000, '+100,000.00%'], [-100000, '-100,000.00%'],
        [100001, MISSING], [-100001, MISSING], [null, MISSING],
        [undefined, MISSING], [NaN, MISSING], [Infinity, MISSING],
    ])
        assert.equal(api.formatPct(value, formatters), expected);
});

test('Vietnamese formatting uses grouping and decimal conventions throughout', () => {
    const {api, formatters} = harness('vi');
    assert.equal(api.formatNumber(1234.56, 'AAPL', formatters), '1.234,56');
    assert.equal(api.formatNumber(1234.56, 'VNM.VN', formatters), '1.235');
    assert.equal(api.formatSigned(-1234.56, 'AAPL', formatters), '-1.234,56');
    assert.equal(api.formatPct(12.5, formatters), '+12,50%');
});

test('makeLabel applies default alignment, ellipsis and single-line mode', () => {
    const {api} = harness();
    const label = api.makeLabel('AAPL', 'stocks-symbol');
    assert.equal(label.text, 'AAPL');
    assert.equal(label.style_class, 'stocks-symbol');
    assert.equal(label.y_align, 'center');
    assert.equal(label.clutter_text.ellipsize, 'ellipsis-end');
    assert.equal(label.clutter_text.single_line_mode, true);
});

test('makeLabel preserves caller overrides and extra actor parameters', () => {
    const {api} = harness();
    const label = api.makeLabel('old', 'old-class', {
        text: 'new', style_class: 'new-class', y_align: 'end', x_expand: true,
    });
    assert.equal(label.text, 'new');
    assert.equal(label.style_class, 'new-class');
    assert.equal(label.y_align, 'end');
    assert.equal(label.x_expand, true);
    assert.equal(label.clutter_text.single_line_mode, true);
});

test('_buildUi creates title, subtitle/timestamp, table and hidden error in order', () => {
    const {widget} = harness();
    assert.deepEqual(widget.children, [
        widget._title, widget.children[1], widget._table, widget._errorText,
    ]);
    assert.equal(widget._title.text, 'FINANCIAL MARKETS');
    assert.equal(widget._title.style_class, 'stocks-title');
    assert.equal(widget.children[1].x_expand, true);
    assert.deepEqual(widget.children[1].children, [widget._subtitle, widget._updated]);
    assert.equal(widget._subtitle.text, 'Yahoo Finance');
    assert.equal(widget._subtitle.style_class, 'stocks-subtitle');
    assert.equal(widget._subtitle.x_expand, true);
    assert.equal(widget._updated.text, 'Updated: --:--');
    assert.equal(widget._updated.x_align, 'end');
    assert.equal(widget._table.vertical, true);
    assert.equal(widget._table.style_class, 'stocks-table');
    assert.equal(widget._table.x_expand, true);
    assert.equal(widget._errorText.text, '');
    assert.equal(widget._errorText.style_class, 'stocks-error');
    assert.equal(widget._errorText.visible, false);
});

test('_buildUi translates the title and timestamp without translating the provider', () => {
    const {widget} = harness('vi');
    assert.equal(widget._title.text, 'TH\u1eca TR\u01af\u1edcNG T\u00c0I CH\u00cdNH');
    assert.equal(widget._updated.text, 'C\u1eadp nh\u1eadt: --:--');
    assert.equal(widget._subtitle.text, 'Yahoo Finance');
});

test('_renderRows preserves order, dimensions and numeric alignment', () => {
    const {widget} = harness();
    const rows = [
        {symbol: 'AAPL', price: 1234.56, change: 2.5, changePercent: 0.25},
        {symbol: 'VNM.VN', price: 1234.56, change: -12.5, changePercent: -1.5},
    ];
    const before = JSON.stringify(rows);
    widget._renderRows(rows);
    assert.equal(JSON.stringify(rows), before);
    assert.equal(widget._table.children.length, 2);
    assert.deepEqual(widget._table.children.map(line => line.children[0].text), ['AAPL', 'VNM.VN']);
    assert.deepEqual(widget._table.children[0].children.map(label => label.text),
        ['AAPL', '1,234.56', '+2.50', '+0.25% \u25b2']);
    assert.deepEqual(widget._table.children[1].children.map(label => label.text),
        ['VNM.VN', '1,235', '-13', '-1.50% \u25bc']);
    for (const line of widget._table.children) {
        assert.equal(line.style_class, 'stocks-row');
        assert.equal(line.x_expand, true);
        assert.deepEqual(line.children.map(label => label.width), [88, 82, 72, 72]);
        assert.equal(line.children[0].x_expand, true);
        for (const label of line.children.slice(1)) {
            assert.equal(label.x_align, 'end');
            assert.equal(label.clutter_text.alignment, 'right');
        }
        for (const label of line.children) {
            assert.equal(label.clutter_text.ellipsize, 'ellipsis-end');
            assert.equal(label.clutter_text.single_line_mode, true);
        }
    }
});

for (const [value, color, arrow] of [
    [1, 'up', '\u25b2'], [-1, 'down', '\u25bc'], [0, 'up', '\u25b2'], [null, 'neutral', null],
]) {
    test(`_renderRows distinguishes ${value} change and percent styling`, () => {
        const {widget} = harness();
        widget._renderRows([{symbol: 'AAPL', price: null, change: value, changePercent: value}]);
        const labels = widget._table.children[0].children;
        assert.equal(labels[1].text, MISSING);
        assert.equal(labels[1].style_class, 'stocks-price');
        assert.equal(labels[2].style_class, `stocks-change stocks-${color}`);
        assert.equal(labels[3].style_class, `stocks-pct stocks-${color}`);
        assert.equal(labels[3].text, arrow === null ? MISSING
            : `${value >= 0 ? '+' : ''}${value.toFixed(2)}% ${arrow}`);
    });
}

test('_renderRows replaces previous actors rather than appending stale rows', () => {
    const {widget} = harness();
    widget._renderRows([{symbol: 'OLD', price: 1, change: 0, changePercent: 0}]);
    const oldRow = widget._table.children[0];
    widget._renderRows([{symbol: 'NEW', price: 2, change: null, changePercent: null}]);
    assert.deepEqual(widget._table.removed, [oldRow]);
    assert.equal(widget._table.children.length, 1);
    assert.equal(widget._table.children[0].children[0].text, 'NEW');
});

test('_renderRows shows one localized empty state and removes it on new data', () => {
    for (const language of ['en', 'vi']) {
        const {widget} = harness(language);
        widget._renderRows([{symbol: 'OLD', price: 1, change: 0, changePercent: 0}]);
        widget._renderRows([]);
        assert.equal(widget._table.children.length, 1);
        const empty = widget._table.children[0];
        assert.equal(empty.style_class, 'stocks-subtitle');
        assert.equal(empty.text, language === 'en'
            ? 'No price data. Add symbols in Preferences.'
            : 'Ch\u01b0a c\u00f3 d\u1eef li\u1ec7u gi\u00e1. Th\u00eam m\u00e3 trong T\u00f9y ch\u1ecdn.');
        widget._renderRows([]);
        assert.equal(widget._table.children.length, 1);
        widget._renderRows([{symbol: 'NEW', price: 1, change: 0, changePercent: 0}]);
        assert.equal(widget._table.children.length, 1);
        assert.equal(widget._table.children[0].children[0].text, 'NEW');
        assert.ok(widget._table.removed.includes(empty));
    }
});

test('_renderRows uses Vietnamese financial formatting in all numeric columns', () => {
    const {widget} = harness('vi');
    widget._renderRows([{symbol: 'AAPL', price: 1234.56, change: -12.5, changePercent: 1.5}]);
    assert.deepEqual(widget._table.children[0].children.map(label => label.text),
        ['AAPL', '1.234,56', '-12,50', '+1,50% \u25b2']);
});
