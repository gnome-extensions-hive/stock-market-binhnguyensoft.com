const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const filename = path.join(__dirname, '..', 'language.js');
const original = readFileSync(filename, 'utf8');
assert.ok(original.includes("import GLib from 'gi://GLib';"));
assert.ok(original.includes('export function translator(settings)'));
const source = original
    .replace("import GLib from 'gi://GLib';", '')
    .replace('export function translator(settings)', 'function translator(settings)');

function fixture(language, locales = ['en_US.UTF-8']) {
    const calls = [];
    const settings = {
        language,
        get_string(key) {
            calls.push(['setting', key]);
            assert.equal(key, 'language');
            return this.language;
        },
    };
    const glib = {
        locales,
        get_language_names() {
            calls.push(['locales']);
            return this.locales;
        },
    };
    const context = vm.createContext({GLib: glib});
    vm.runInContext(source, context, {filename});
    return {settings, glib, calls, translator: context.translator};
}

for (const [language, expected] of [['vi', 'vietnamese'], ['en', 'english']]) {
    test(`explicit ${language} ignores the system locale`, () => {
        const f = fixture(language);
        f.glib.get_language_names = () => {
            assert.fail('explicit language must not query GLib locales');
        };
        const translate = f.translator(f.settings);
        assert.equal(translate('english', 'vietnamese'), expected);
        assert.deepEqual(f.calls, [['setting', 'language']]);
    });
}

for (const locale of ['vi', 'vi_VN.UTF-8', 'VI_vn', 'Vi-VN']) {
    test(`automatic language selects Vietnamese for ${locale}`, () => {
        const f = fixture('auto', [locale, 'en_US.UTF-8']);
        assert.equal(f.translator(f.settings)('english', 'vietnamese'), 'vietnamese');
        assert.deepEqual(f.calls, [['setting', 'language'], ['locales']]);
    });
}

for (const locale of ['en_US.UTF-8', 'fr_FR.UTF-8', 'C']) {
    test(`automatic language selects English for primary locale ${locale}`, () => {
        const f = fixture('auto', [locale, 'vi_VN.UTF-8']);
        assert.equal(f.translator(f.settings)('english', 'vietnamese'), 'english');
        assert.deepEqual(f.calls, [['setting', 'language'], ['locales']]);
    });
}

test('an unknown language setting selects English without querying locales', () => {
    const f = fixture('unexpected', ['vi_VN.UTF-8']);
    assert.equal(f.translator(f.settings)('english', 'vietnamese'), 'english');
    assert.deepEqual(f.calls, [['setting', 'language']]);
});

test('existing translators snapshot settings; new translators read changes', () => {
    const f = fixture('en');
    const english = f.translator(f.settings);
    f.settings.language = 'vi';
    const vietnamese = f.translator(f.settings);
    assert.equal(english('english', 'vietnamese'), 'english');
    assert.equal(vietnamese('english', 'vietnamese'), 'vietnamese');
    assert.equal(english('another English value', 'another Vietnamese value'),
        'another English value');
    assert.deepEqual(f.calls, [['setting', 'language'], ['setting', 'language']]);
});

test('automatic translators snapshot locales; new translators read changes', () => {
    const f = fixture('auto', ['vi_VN.UTF-8']);
    const vietnamese = f.translator(f.settings);
    f.glib.locales = ['en_US.UTF-8'];
    const english = f.translator(f.settings);
    assert.equal(vietnamese('english', 'vietnamese'), 'vietnamese');
    assert.equal(english('english', 'vietnamese'), 'english');
    assert.deepEqual(f.calls, [
        ['setting', 'language'], ['locales'],
        ['setting', 'language'], ['locales'],
    ]);
});

test('the selected translation is returned verbatim without a fallback', () => {
    for (const language of ['en', 'vi']) {
        const f = fixture(language);
        const translate = f.translator(f.settings);
        const english = {};
        const vietnamese = {};
        assert.equal(translate(english, vietnamese), language === 'vi' ? vietnamese : english);
        assert.equal(translate('', ''), '');
        assert.equal(translate(null, null), null);
        assert.equal(translate(undefined, undefined), undefined);
    }
});

test('settings read failures propagate to the caller', () => {
    const f = fixture('en');
    const failure = new Error('settings unavailable');
    f.settings.get_string = () => { throw failure; };
    assert.throws(() => f.translator(f.settings), error => error === failure);
});

test('automatic locale lookup failures propagate to the caller', () => {
    const f = fixture('auto');
    const failure = new Error('locale lookup unavailable');
    f.glib.get_language_names = () => { throw failure; };
    assert.throws(() => f.translator(f.settings), error => error === failure);
});
