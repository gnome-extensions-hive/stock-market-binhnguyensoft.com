# Translator contract tests

Run from the repository root with Node.js:

```sh
node --test tests/language.test.cjs
```

The dependency-free tests execute `language.js::translator` in fresh Node VM
contexts. Only the GLib import and function export syntax are adapted; the
function body is unchanged. Settings and GLib locale lookup are doubles. No
GNOME session, user settings, network, or subprocess is involved.

The suite checks explicit English/Vietnamese selection, automatic locale
selection and case normalization, primary-locale precedence, unknown-setting
behavior, snapshot semantics when settings/locales change, verbatim return
values, and propagation of settings/locale lookup errors. It does not exercise
real GLib locale ordering, GSettings, GTK, or Shell rendering.

Collect raw V8 execution coverage separately from the working tree:

```sh
coverage_dir="$(mktemp -d /tmp/stock-language-coverage.XXXXXX)"
NODE_V8_COVERAGE="$coverage_dir" node --test tests/language.test.cjs
```

The raw JSON records ranges for the adapted VM source, not unchanged-source line
coverage. It cannot be merged with coverage of differently transformed source.
The baseline README and tracked inventory define no integration/E2E runner or
coverage service. No integration/E2E coverage percentage is inferred from this
offline suite.
