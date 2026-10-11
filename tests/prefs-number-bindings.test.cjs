const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'prefs.js'), 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace('export default class StockMarketPreferences',
        'globalThis.StockMarketPreferences = class StockMarketPreferences');

function setup({failBinding = null, failAdjustment = false} = {}) {
    const bindings = [];
    const failure = new Error('numeric settings adapter failed');

    class Widget {
        constructor(properties = {}) {
            Object.assign(this, properties);
            this.children = [];
        }
        add(child) { this.children.push(child); }
        add_suffix(child) { this.add(child); }
        connect() {}
        add_css_class() {}
        set_default_size() {}
    }

    class SpinRow extends Widget {}
    class Adjustment extends Widget {
        constructor(properties) {
            if (failAdjustment)
                throw failure;
            super(properties);
        }
    }

    const settings = {
        get_strv: () => [],
        get_string: () => 'en',
        bind(key, row, property, flags) {
            if (key === failBinding)
                throw failure;
            bindings.push({key, row, property, flags});
        },
        connect() {},
    };
    const defaultFlags = 17;
    const context = vm.createContext({
        Adw: {
            PreferencesPage: Widget, PreferencesGroup: Widget,
            ComboRow: Widget, SpinRow, ActionRow: Widget,
        },
        Gtk: {
            Entry: Widget, Button: Widget, Adjustment,
            Align: {CENTER: 0}, StringList: {new: items => items},
        },
        Gio: {SettingsBindFlags: {DEFAULT: defaultFlags}},
        GLib: {PRIORITY_DEFAULT_IDLE: 0, idle_add() {}},
        ExtensionPreferences: class {
            getSettings() { return settings; }
        },
        translator: () => english => `translated:${english}`,
    });
    vm.runInContext(source, context, {filename: 'prefs-number-bindings-source.js'});
    const window = new Widget();
    const preferences = new context.StockMarketPreferences();
    return {
        bindings, defaultFlags, failure, window, SpinRow, Adjustment,
        fill: () => preferences.fillPreferencesWindow(window),
    };
}

const contracts = [
    ['left', 'Position', 'Distance from the left edge (in pixels).', 0, 10000],
    ['top', 'Position', 'Distance from the top edge (in pixels).', 0, 10000],
    ['duration', 'Updates', 'Update interval (minutes)', 5, 300],
];

for (const [key, groupTitle, title, lower, upper] of contracts) {
    test(`${key} binds its own SpinRow value using DEFAULT flags`, () => {
        const ui = setup();
        ui.fill();
        const matches = ui.bindings.filter(binding => binding.key === key);
        assert.equal(matches.length, 1);
        const binding = matches[0];
        assert.ok(binding.row instanceof ui.SpinRow);
        assert.equal(binding.property, 'value');
        assert.equal(binding.flags, ui.defaultFlags);
        assert.equal(binding.row.digits, 0);
        assert.equal(binding.row.numeric, true);
    });

    test(`${key} adjustment retains its bounds and five-unit step`, () => {
        const ui = setup();
        ui.fill();
        const adjustment = ui.bindings.find(binding => binding.key === key).row.adjustment;
        assert.ok(adjustment instanceof ui.Adjustment);
        assert.equal(adjustment.lower, lower);
        assert.equal(adjustment.upper, upper);
        assert.equal(adjustment.step_increment, 5);
    });

    test(`${key} attaches the bound row to its translated settings group`, () => {
        const ui = setup();
        ui.fill();
        const row = ui.bindings.find(binding => binding.key === key).row;
        const page = ui.window.children[0];
        const groups = page.children.filter(group => group.children.includes(row));
        assert.equal(groups.length, 1);
        assert.equal(groups[0].title, `translated:${groupTitle}`);
        assert.equal(row.title, `translated:${title}`);
    });
}

test('numeric bindings use exactly the three expected keys and independent adjustments', () => {
    const ui = setup();
    ui.fill();
    assert.deepEqual(ui.bindings.map(binding => binding.key), ['left', 'top', 'duration']);
    assert.equal(new Set(ui.bindings.map(binding => binding.row)).size, 3);
    assert.equal(new Set(ui.bindings.map(binding => binding.row.adjustment)).size, 3);
    const page = ui.window.children[0];
    const position = page.children.find(group => group.title === 'translated:Position');
    const updates = page.children.find(group => group.title === 'translated:Updates');
    assert.deepEqual(position.children, ui.bindings.slice(0, 2).map(binding => binding.row));
    assert.deepEqual(updates.children, [ui.bindings[2].row]);
});

for (const key of ['left', 'top', 'duration']) {
    test(`${key} binding errors propagate without publishing a partial page`, () => {
        const ui = setup({failBinding: key});
        assert.throws(ui.fill, error => error === ui.failure);
        assert.deepEqual(ui.bindings.map(binding => binding.key),
            ['left', 'top', 'duration'].slice(0, ['left', 'top', 'duration'].indexOf(key)));
        assert.equal(ui.window.children.length, 0);
    });
}

test('adjustment construction errors propagate before any binding or page publication', () => {
    const ui = setup({failAdjustment: true});
    assert.throws(ui.fill, error => error === ui.failure);
    assert.equal(ui.bindings.length, 0);
    assert.equal(ui.window.children.length, 0);
});
