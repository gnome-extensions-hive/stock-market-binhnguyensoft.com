const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'prefs.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default class StockMarketPreferences',
        'globalThis.StockMarketPreferences = class StockMarketPreferences');

function setup(metadata = {}, dialogAvailable = true) {
    class Widget {
        constructor(children = []) {
            this.children = children;
            children.forEach((child, index) => {
                child.nextSibling = children[index + 1] ?? null;
            });
        }
        get_first_child() { return this.children[0] ?? null; }
        get_next_sibling() { return this.nextSibling ?? null; }
    }
    class HeaderBar extends Widget {
        constructor() {
            super();
            this.packed = [];
        }
        pack_end(button) { this.packed.push(button); }
    }
    const buttons = [];
    class Button {
        constructor(properties) {
            Object.assign(this, properties);
            this.css = [];
            this.signals = new Map();
            buttons.push(this);
        }
        add_css_class(name) { this.css.push(name); }
        connect(signal, callback) {
            assert.equal(this.signals.has(signal), false);
            this.signals.set(signal, callback);
        }
        click() {
            assert.ok(this.signals.has('clicked'));
            return this.signals.get('clicked')();
        }
    }
    const presentations = [];
    function aboutClass(kind) {
        return class {
            constructor(params) { this.params = params; }
            present(...args) {
                presentations.push({kind, params: this.params, args});
            }
        };
    }
    const Adw = {
        HeaderBar,
        AboutDialog: dialogAvailable ? aboutClass('dialog') : undefined,
        AboutWindow: aboutClass('window'),
    };
    const context = vm.createContext({
        Adw,
        Gtk: {Button, Align: {CENTER: 3}},
        ExtensionPreferences: class {},
    });
    vm.runInContext(source, context, {filename: 'prefs.js'});
    const prefs = new context.StockMarketPreferences();
    prefs.metadata = metadata;
    return {prefs, Widget, HeaderBar, buttons, presentations, Adw};
}

test('header discovery accepts the root itself', () => {
    const {prefs, HeaderBar} = setup();
    const header = new HeaderBar();
    assert.equal(prefs._findHeaderBar(header), header);
});

test('header discovery walks nested children and later siblings', () => {
    const {prefs, Widget, HeaderBar} = setup();
    const header = new HeaderBar();
    const root = new Widget([
        new Widget([new Widget()]),
        new Widget([new Widget(), new Widget([header])]),
    ]);
    assert.equal(prefs._findHeaderBar(root), header);
});

test('header discovery returns the first depth-first match', () => {
    const {prefs, Widget, HeaderBar} = setup();
    const first = new HeaderBar();
    const second = new HeaderBar();
    assert.equal(prefs._findHeaderBar(new Widget([
        new Widget([first]), second,
    ])), first);
});

test('missing headers return null and do not create a button', () => {
    const {prefs, Widget, buttons} = setup();
    const root = new Widget([new Widget([new Widget()])]);
    assert.equal(prefs._findHeaderBar(root), null);
    prefs._addAboutButton(root);
    assert.deepEqual(buttons, []);
});

test('About button is packed once, styled, and opens for its original window', () => {
    const {prefs, Widget, HeaderBar, buttons, presentations} = setup();
    const header = new HeaderBar();
    const window = new Widget([header]);
    prefs._addAboutButton(window);
    prefs._addAboutButton(window);
    assert.equal(buttons.length, 1);
    assert.deepEqual(header.packed, buttons);
    assert.equal(header._hasAboutButton, true);
    const [button] = buttons;
    assert.equal(button.icon_name, 'open-menu-symbolic');
    assert.equal(button.tooltip_text, 'About');
    assert.equal(button.valign, 3);
    assert.deepEqual(button.css, ['flat']);
    assert.equal(presentations.length, 0);
    button.click();
    assert.equal(presentations.length, 1);
    assert.deepEqual(presentations[0].args, [window]);
});

test('an already marked header is not modified', () => {
    const {prefs, HeaderBar, buttons} = setup();
    const header = new HeaderBar();
    header._hasAboutButton = true;
    prefs._addAboutButton(header);
    assert.deepEqual(buttons, []);
    assert.deepEqual(header.packed, []);
});

test('each window receives its own About button and presentation parent', () => {
    const {prefs, HeaderBar, buttons, presentations} = setup();
    const first = new HeaderBar();
    const second = new HeaderBar();
    prefs._addAboutButton(first);
    prefs._addAboutButton(second);
    buttons[0].click();
    buttons[1].click();
    assert.deepEqual(presentations.map(item => item.args), [[first], [second]]);
});

for (const dialogAvailable of [true, false]) {
    test(`About ${dialogAvailable ? 'dialog' : 'window'} presents metadata and correct parent`, () => {
        const metadata = {
            name: 'Example Widget', 'version-name': '2.4-beta', version: 9,
            url: 'https://example.invalid/project///',
        };
        const {prefs, Widget, presentations} = setup(metadata, dialogAvailable);
        const window = new Widget();
        prefs._showAbout(window);
        assert.equal(presentations.length, 1);
        const [{kind, params, args}] = presentations;
        assert.equal(kind, dialogAvailable ? 'dialog' : 'window');
        assert.equal(params.application_name, 'Example Widget');
        assert.equal(params.developer_name, 'Binh Nguyen');
        assert.equal(params.version, '2.4-beta');
        assert.equal(params.website, 'https://www.binhnguyensoft.com');
        assert.equal(params.issue_url, 'https://example.invalid/project/issues');
        if (dialogAvailable) {
            assert.deepEqual(args, [window]);
            assert.equal(Object.hasOwn(params, 'transient_for'), false);
            assert.equal(Object.hasOwn(params, 'modal'), false);
        } else {
            assert.deepEqual(args, []);
            assert.equal(params.transient_for, window);
            assert.equal(params.modal, true);
        }
        assert.deepEqual(metadata, {
            name: 'Example Widget', 'version-name': '2.4-beta', version: 9,
            url: 'https://example.invalid/project///',
        });
    });
}

for (const [metadata, expected] of [
    [{}, '1.0.0'],
    [{version: 12}, '12'],
    [{'version-name': null, version: 12}, '12'],
    [{'version-name': '', version: 12}, ''],
    [{'version-name': 0, version: 12}, '0'],
    [{version: 0}, '1.0.0'],
]) {
    test(`version fallback preserves ${JSON.stringify(metadata)}`, () => {
        const {prefs, Widget, presentations} = setup(metadata);
        prefs._showAbout(new Widget());
        assert.equal(presentations[0].params.version, expected);
        assert.equal(presentations[0].params.application_name, 'Stock Market Widget');
        assert.equal(presentations[0].params.issue_url,
            'https://www.binhnguyensoft.com/issues');
    });
}

test('empty metadata name and URL use the existing defaults', () => {
    const {prefs, Widget, presentations} = setup({name: '', url: ''});
    prefs._showAbout(new Widget());
    assert.equal(presentations[0].params.application_name, 'Stock Market Widget');
    assert.equal(presentations[0].params.issue_url, 'https://www.binhnguyensoft.com/issues');
});

test('dialog construction failures propagate rather than falling back silently', () => {
    const {prefs, Widget, Adw, presentations} = setup();
    const failure = new Error('dialog construction failed');
    Adw.AboutDialog = class { constructor() { throw failure; } };
    assert.throws(() => prefs._showAbout(new Widget()), error => error === failure);
    assert.deepEqual(presentations, []);
});

test('presentation failures propagate through the About button callback', () => {
    const {prefs, HeaderBar, Adw, buttons} = setup();
    const failure = new Error('presentation failed');
    Adw.AboutDialog = class { present() { throw failure; } };
    prefs._addAboutButton(new HeaderBar());
    assert.throws(() => buttons[0].click(), error => error === failure);
});
