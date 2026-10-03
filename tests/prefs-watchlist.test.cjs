const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'prefs.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default class StockMarketPreferences',
        'globalThis.StockMarketPreferences = class StockMarketPreferences');

function setup(initial = ['AAPL', 'BTC-USD', '^GSPC']) {
    class Widget {
        constructor(properties = {}) {
            Object.assign(this, {visible: true, sensitive: true, text: ''}, properties);
            this.children = [];
            this.signals = new Map();
            this.css = new Set();
        }
        add(child) { this.children.push(child); }
        add_suffix(child) { this.add(child); }
        remove(child) {
            const index = this.children.indexOf(child);
            assert.notEqual(index, -1, 'only attached children may be removed');
            this.children.splice(index, 1);
        }
        connect(signal, callback) {
            assert.equal(this.signals.has(signal), false);
            this.signals.set(signal, callback);
            return signal;
        }
        emit(signal) {
            assert.equal(this.signals.has(signal), true, `missing signal: ${signal}`);
            return this.signals.get(signal)(this);
        }
        add_css_class(name) { this.css.add(name); }
        remove_css_class(name) { this.css.delete(name); }
        grab_focus() { this.focused = true; }
        set_default_size(width, height) { this.size = [width, height]; }
    }
    const values = [...initial];
    const writes = [];
    const settingsSignals = new Map();
    const disconnected = [];
    const settings = {
        language: 'en',
        saveSucceeds: true,
        get_strv(key) {
            assert.equal(key, 'symbols');
            return [...values];
        },
        set_strv(key, symbols) {
            assert.equal(key, 'symbols');
            writes.push(Array.from(symbols));
            if (!this.saveSucceeds)
                return false;
            values.splice(0, values.length, ...symbols);
            return true;
        },
        get_string(key) {
            assert.equal(key, 'language');
            return this.language;
        },
        set_string(key, value) {
            assert.equal(key, 'language');
            this.language = value;
            settingsSignals.get('changed::language')();
        },
        bind() {},
        connect(signal, callback) {
            settingsSignals.set(signal, callback);
            return signal;
        },
        disconnect(id) {
            assert.equal(settingsSignals.delete(id), true);
            disconnected.push(id);
        },
    };
    const idleCallbacks = [];
    const context = vm.createContext({
        Adw: {
            PreferencesPage: Widget, PreferencesGroup: Widget, ComboRow: Widget,
            SpinRow: Widget, ActionRow: Widget,
        },
        Gtk: {
            Entry: Widget, Button: Widget, Adjustment: Widget,
            Align: {CENTER: 0}, StringList: {new: items => items},
        },
        Gio: {SettingsBindFlags: {DEFAULT: 0}},
        GLib: {
            PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false,
            idle_add(priority, callback) { idleCallbacks.push(callback); },
        },
        ExtensionPreferences: class {
            getSettings() { return settings; }
        },
        translator: () => english => english,
    });
    vm.runInContext(source, context, {filename: 'prefs.js'});
    const window = new Widget();
    new context.StockMarketPreferences().fillPreferencesWindow(window);

    const group = () => window.children[0].children.find(child => child.title === 'Symbols');
    const rows = () => group().children.filter(child => child._editor);
    const input = () => group().children[0].children[0];
    const status = () => group().children[1];
    const saveRow = () => group().children[2];
    const click = (row, label) => {
        const button = row.children.find(child =>
            child.tooltip_text === label || child.label === label);
        assert.ok(button, `missing button: ${label}`);
        return button.emit('clicked');
    };
    return {
        settings, window, writes, values, disconnected, idleCallbacks,
        rows, input, status, saveRow, click,
        titles: () => rows().map(row => row.title),
        add(value, activate = false) {
            input().text = value;
            if (activate)
                input().emit('activate');
            else
                click(group().children[0], 'Add symbol');
        },
        save() { click(saveRow(), 'Save list'); },
    };
}

test('initial watchlist is a clean, detached draft with ordered rows', () => {
    const ui = setup();
    assert.deepEqual(ui.titles(), ui.values);
    assert.deepEqual(ui.window.size, [640, 650]);
    assert.equal(ui.saveRow().title, 'Saved list');
    assert.equal(ui.status().visible, false);
    assert.equal(ui.rows()[0].children.find(child => child.tooltip_text === 'Move up').sensitive, false);
    assert.equal(ui.rows().at(-1).children.find(child => child.tooltip_text === 'Move down').sensitive, false);
    assert.equal(ui.idleCallbacks.length, 1);
    assert.deepEqual(ui.writes, []);
});

for (const [value, normalized] of [
    ['  msft  ', 'MSFT'], ['GC=F', 'GC=F'], ['^DJI', '^DJI'],
    ['DX-Y.NYB', 'DX-Y.NYB'], ['A_1', 'A_1'], ['A'.repeat(32), 'A'.repeat(32)],
]) {
    test(`adding ${JSON.stringify(value)} normalizes only the draft until Save`, () => {
        const ui = setup();
        const original = [...ui.values];
        ui.add(value);
        assert.deepEqual(ui.titles(), [...original, normalized]);
        assert.deepEqual(ui.values, original);
        assert.deepEqual(ui.writes, []);
        assert.equal(ui.input().text, '');
        assert.equal(ui.input().focused, true);
        assert.equal(ui.saveRow().title, 'Unsaved changes');
        ui.save();
        assert.deepEqual(ui.values, [...original, normalized]);
        assert.deepEqual(ui.writes, [[...original, normalized]]);
        assert.equal(ui.saveRow().title, 'List saved');
        assert.equal(ui.status().visible, false);
    });
}

for (const value of ['', ' ', '.AAPL', '-AAPL', 'A B', 'A/B', 'A,B', 'A'.repeat(33)]) {
    test(`invalid symbol ${JSON.stringify(value)} does not mutate or persist the draft`, () => {
        const ui = setup();
        ui.add(value);
        assert.deepEqual(ui.titles(), ui.values);
        assert.deepEqual(ui.writes, []);
        assert.equal(ui.status().title, 'Enter one valid symbol (up to 32 characters).');
        assert.equal(ui.status().visible, true);
        assert.equal(ui.input().css.has('error'), true);
    });
}

test('duplicates are rejected after normalization and a successful add clears the error', () => {
    const ui = setup();
    ui.add(' aapl ');
    assert.equal(ui.status().title, 'This symbol is already in the list.');
    assert.deepEqual(ui.titles(), ui.values);
    ui.add('MSFT', true);
    assert.equal(ui.status().visible, false);
    assert.equal(ui.input().css.has('error'), false);
    assert.equal(ui.titles().at(-1), 'MSFT');
    assert.deepEqual(ui.writes, []);
});

test('the twentieth symbol is accepted but the twenty-first is blocked', () => {
    const initial = Array.from({length: 19}, (_, index) => `S${index}`);
    const ui = setup(initial);
    ui.add('S19');
    assert.equal(ui.rows().length, 20);
    ui.add('S20');
    assert.equal(ui.rows().length, 20);
    assert.equal(ui.status().title, 'You can track up to 20 symbols.');
    assert.deepEqual(ui.values, initial);
    assert.deepEqual(ui.writes, []);
});

test('Save refuses non-whitespace pending add input but accepts whitespace', () => {
    const ui = setup();
    ui.input().text = 'MSFT';
    ui.save();
    assert.deepEqual(ui.writes, []);
    assert.equal(ui.status().title, 'Add the typed symbol and finish editing with Done before saving the list.');
    ui.input().text = '   ';
    ui.save();
    assert.deepEqual(ui.writes, [ui.values]);
    assert.equal(ui.status().visible, false);
});

test('a failed settings write preserves the draft and can be retried', () => {
    const ui = setup();
    ui.add('MSFT');
    ui.settings.saveSucceeds = false;
    ui.save();
    assert.deepEqual(ui.values, ['AAPL', 'BTC-USD', '^GSPC']);
    assert.equal(ui.saveRow().title, 'Unsaved changes');
    assert.equal(ui.status().title, 'Could not save the list. Please try again.');
    assert.equal(ui.status().visible, true);
    ui.settings.saveSucceeds = true;
    ui.save();
    assert.equal(ui.values.at(-1), 'MSFT');
    assert.equal(ui.status().visible, false);
    assert.equal(ui.writes.length, 2);
});

test('edit controls toggle visibility and Done normalizes the draft without saving', () => {
    const ui = setup();
    const row = ui.rows()[0];
    ui.click(row, 'Edit symbol');
    assert.equal(row.title, '');
    assert.equal(row._editor.visible, true);
    assert.equal(row._editor.focused, true);
    for (const control of row.children.slice(1))
        assert.equal(control.visible, ['Done editing', 'Cancel'].includes(control.tooltip_text));
    row._editor.text = '  msft ';
    ui.click(row, 'Done editing');
    assert.deepEqual(ui.titles(), ['MSFT', 'BTC-USD', '^GSPC']);
    assert.equal(ui.rows()[0]._editor.visible, false);
    assert.deepEqual(ui.values, ['AAPL', 'BTC-USD', '^GSPC']);
    assert.deepEqual(ui.writes, []);
    ui.save();
    assert.deepEqual(ui.values, ui.titles());
});

test('editing to an existing symbol is rejected; unchanged symbols remain valid at capacity', () => {
    const ui = setup(Array.from({length: 20}, (_, index) => `S${index}`));
    const row = ui.rows()[0];
    ui.click(row, 'Edit symbol');
    row._editor.text = 's1';
    row._editor.emit('activate');
    assert.equal(ui.status().title, 'This symbol is already in the list.');
    assert.equal(row._editor.css.has('error'), true);
    assert.equal(row._editor.visible, true);
    row._editor.text = 's0';
    row._editor.emit('activate');
    assert.deepEqual(ui.titles(), ui.values);
    assert.equal(ui.status().visible, false);
    assert.equal(ui.saveRow().title, 'Saved list');
    assert.deepEqual(ui.writes, []);
});

test('invalid edited symbols keep the editor open and Cancel discards the edit', () => {
    const ui = setup();
    const row = ui.rows()[0];
    ui.click(row, 'Edit symbol');
    row._editor.text = 'BAD SYMBOL';
    ui.click(row, 'Done editing');
    assert.equal(ui.status().visible, true);
    assert.equal(row._editor.visible, true);
    assert.equal(row._editor.css.has('error'), true);
    ui.click(row, 'Cancel');
    assert.deepEqual(ui.titles(), ui.values);
    assert.equal(ui.status().visible, false);
    assert.equal(ui.rows()[0]._editor.visible, false);
    assert.deepEqual(ui.writes, []);
});

for (const operation of ['add', 'edit', 'move', 'delete', 'save']) {
    test(`an active edit blocks ${operation} without changing the draft or settings`, () => {
        const ui = setup();
        const [editing, other] = ui.rows();
        ui.click(editing, 'Edit symbol');
        editing._editor.text = 'MSFT';
        if (operation === 'add') ui.add('GOOG');
        if (operation === 'edit') ui.click(other, 'Edit symbol');
        if (operation === 'move') ui.click(other, 'Move up');
        if (operation === 'delete') ui.click(other, 'Delete symbol');
        if (operation === 'save') ui.save();
        assert.equal(ui.status().visible, true);
        assert.equal(ui.status().title, operation === 'save'
            ? 'Add the typed symbol and finish editing with Done before saving the list.'
            : 'Finish the current edit with Done or Cancel first.');
        assert.equal(other._editor.visible, false);
        assert.equal(editing._editor.text, 'MSFT');
        assert.deepEqual(ui.writes, []);
        ui.click(editing, 'Cancel');
        assert.deepEqual(ui.titles(), ui.values);
    });
}

test('reordering preserves symbols and order is persisted only on Save', () => {
    const ui = setup();
    ui.click(ui.rows()[1], 'Move up');
    assert.deepEqual(ui.titles(), ['BTC-USD', 'AAPL', '^GSPC']);
    ui.click(ui.rows()[1], 'Move down');
    assert.deepEqual(ui.titles(), ['BTC-USD', '^GSPC', 'AAPL']);
    ui.click(ui.rows()[0], 'Move up');
    ui.click(ui.rows().at(-1), 'Move down');
    assert.deepEqual(ui.titles(), ['BTC-USD', '^GSPC', 'AAPL']);
    assert.deepEqual(ui.values, ['AAPL', 'BTC-USD', '^GSPC']);
    assert.deepEqual(ui.writes, []);
    ui.save();
    assert.deepEqual(ui.values, ui.titles());
});

test('deleting every symbol can save an empty watchlist', () => {
    const ui = setup(['AAPL']);
    ui.click(ui.rows()[0], 'Delete symbol');
    assert.deepEqual(ui.titles(), []);
    assert.deepEqual(ui.values, ['AAPL']);
    assert.deepEqual(ui.writes, []);
    ui.save();
    assert.deepEqual(ui.values, []);
    assert.deepEqual(ui.writes, [[]]);
    assert.equal(ui.saveRow().title, 'List saved');
});

test('language rebuild replaces the page while preserving completed unsaved draft changes', () => {
    const ui = setup();
    ui.add('MSFT');
    const oldPage = ui.window.children[0];
    const languageRow = oldPage.children[0].children[0];
    languageRow.selected = 2;
    languageRow.emit('notify::selected');
    assert.equal(ui.settings.language, 'vi');
    assert.equal(ui.window.children.length, 1);
    assert.notEqual(ui.window.children[0], oldPage);
    assert.equal(ui.window.children[0].children[0].children[0].selected, 2);
    assert.deepEqual(ui.titles(), ['AAPL', 'BTC-USD', '^GSPC', 'MSFT']);
    assert.equal(ui.saveRow().title, 'Unsaved changes');
    assert.deepEqual(ui.writes, []);
    ui.save();
    assert.deepEqual(ui.values, ui.titles());
});

test('closing disconnects the language listener and does not save draft changes', () => {
    const ui = setup();
    ui.add('MSFT');
    assert.equal(ui.window.emit('close-request'), false);
    assert.deepEqual(ui.disconnected, ['changed::language']);
    assert.deepEqual(ui.values, ['AAPL', 'BTC-USD', '^GSPC']);
    assert.deepEqual(ui.writes, []);
});
