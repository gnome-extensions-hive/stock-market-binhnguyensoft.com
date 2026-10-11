const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const filename = path.join(__dirname, '..', 'extension.js');
const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .+;\r?$/gm, '')
    .replace('export default class FinancialMarketsExtension', 'class FinancialMarketsExtension');

function fixture(moduleSource = source) {
    const widgets = [];
    const errors = [];
    let constructionError = null;
    class Widget {
        constructor(extension) {
            if (constructionError)
                throw constructionError;
            this.extension = extension;
            this.destroyCalls = 0;
            widgets.push(this);
        }

        destroy() {
            this.destroyCalls++;
        }
    }
    class Extension {}
    const context = vm.createContext({
        Extension,
        Gio: {_promisify() {}, Subprocess: {prototype: {}}},
        GObject: {registerClass: () => Widget},
        St: {BoxLayout: class {}},
        console: {error: message => errors.push(message)},
    });
    vm.runInContext(`${moduleSource}\nthis.extension = new FinancialMarketsExtension();`,
        context, {filename});
    return {
        extension: context.extension,
        widgets,
        errors,
        failConstruction(error) {
            constructionError = error;
        },
    };
}

test('enable constructs and owns one widget with the extension instance', () => {
    const {extension, widgets, errors} = fixture();
    extension.enable();
    assert.equal(widgets.length, 1);
    assert.equal(extension._widget, widgets[0]);
    assert.equal(widgets[0].extension, extension);
    assert.equal(widgets[0].destroyCalls, 0);
    assert.deepEqual(errors, []);
});

test('disable destroys the owned widget and clears the reference', () => {
    const {extension, widgets, errors} = fixture();
    extension.enable();
    extension.disable();
    assert.equal(widgets[0].destroyCalls, 1);
    assert.equal(extension._widget, null);
    assert.deepEqual(errors, []);
});

test('disable before enable is harmless and clears the reference', () => {
    const {extension, widgets, errors} = fixture();
    extension.disable();
    assert.equal(extension._widget, null);
    assert.deepEqual(widgets, []);
    assert.deepEqual(errors, []);
});

test('repeated disable does not destroy the same widget twice', () => {
    const {extension, widgets, errors} = fixture();
    extension.enable();
    extension.disable();
    extension.disable();
    assert.equal(widgets[0].destroyCalls, 1);
    assert.equal(extension._widget, null);
    assert.deepEqual(errors, []);
});

test('enable after disable constructs a new owned widget', () => {
    const {extension, widgets, errors} = fixture();
    extension.enable();
    extension.disable();
    extension.enable();
    assert.equal(widgets.length, 2);
    assert.notEqual(widgets[0], widgets[1]);
    assert.equal(extension._widget, widgets[1]);
    assert.equal(widgets[0].destroyCalls, 1);
    assert.equal(widgets[1].destroyCalls, 0);
    extension.disable();
    assert.equal(widgets[1].destroyCalls, 1);
    assert.deepEqual(errors, []);
});

test('construction failure logs its cause and leaves no owned widget', () => {
    const f = fixture();
    f.failConstruction(new Error('construction failed'));
    assert.doesNotThrow(() => f.extension.enable());
    assert.equal(f.extension._widget, null);
    assert.deepEqual(f.widgets, []);
    assert.deepEqual(f.errors, [
        'Extension: stock-market@binhnguyensoft.com: enable failed: Error: construction failed',
    ]);
    f.extension.disable();
    assert.equal(f.errors.length, 1);
});

test('a failed construction cleans up an existing reference before clearing it', () => {
    const f = fixture();
    f.extension.enable();
    f.failConstruction(new Error('replacement failed'));
    f.extension.enable();
    assert.equal(f.widgets.length, 1);
    assert.equal(f.widgets[0].destroyCalls, 1);
    assert.equal(f.extension._widget, null);
    assert.deepEqual(f.errors, [
        'Extension: stock-market@binhnguyensoft.com: enable failed: Error: replacement failed',
    ]);
});

test('secondary enable cleanup failure does not escape or retain ownership', () => {
    const f = fixture();
    let cleanupCalls = 0;
    f.extension._widget = {
        destroy() {
            cleanupCalls++;
            throw new Error('secondary cleanup failed');
        },
    };
    f.failConstruction(new Error('construction failed'));
    assert.doesNotThrow(() => f.extension.enable());
    assert.equal(cleanupCalls, 1);
    assert.equal(f.extension._widget, null);
    assert.deepEqual(f.errors, [
        'Extension: stock-market@binhnguyensoft.com: enable failed: Error: construction failed',
    ]);
});

test('disable cleanup failure logs its cause and still clears ownership', () => {
    const f = fixture();
    f.extension.enable();
    f.widgets[0].destroy = function () {
        this.destroyCalls++;
        throw new Error('destroy failed');
    };
    assert.doesNotThrow(() => f.extension.disable());
    assert.equal(f.widgets[0].destroyCalls, 1);
    assert.equal(f.extension._widget, null);
    assert.deepEqual(f.errors, [
        'Extension: stock-market@binhnguyensoft.com: disable cleanup failed: Error: destroy failed',
    ]);
    f.extension.disable();
    assert.equal(f.widgets[0].destroyCalls, 1);
    assert.equal(f.errors.length, 1);
});

test('enable can recover after a construction failure', () => {
    const f = fixture();
    f.failConstruction(new Error('temporary failure'));
    f.extension.enable();
    f.failConstruction(null);
    f.extension.enable();
    assert.equal(f.widgets.length, 1);
    assert.equal(f.extension._widget, f.widgets[0]);
    assert.equal(f.widgets[0].extension, f.extension);
    assert.equal(f.errors.length, 1);
    f.extension.disable();
    assert.equal(f.widgets[0].destroyCalls, 1);
});
