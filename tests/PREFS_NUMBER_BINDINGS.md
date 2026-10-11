# Numeric preferences binding contracts

Run the dependency-free offline suite:

```sh
node --test tests/prefs-number-bindings.test.cjs
```

Collect raw V8 execution data outside the checkout:

```sh
NODE_V8_COVERAGE="$(mktemp -d /tmp/stock-number-bindings-coverage.XXXXXX)" \
    node --test tests/prefs-number-bindings.test.cjs
```

The suite executes the unchanged `prefs.js` module body in a fresh VM context
per test, adapting only imports and the default export. Its scope is the local
`addNumberSettingRow` helper and its three initial call sites: left and top
offsets and the refresh interval. Assertions cover row type, numeric/integer
configuration, adjustment bounds and step, binding target/property/default
flags, translated group placement, independent adjustments, and propagation
of construction/binding failures without publishing a partial page.

GTK, libadwaita, GSettings, translation, and idle scheduling are controlled
doubles. These tests observe calls to `settings.bind`; they do not implement
or validate real bidirectional GSettings synchronization or range enforcement.
Watchlist callbacks, language selection/rebuilds, close-request cleanup,
About behavior, source-schema declarations, and widget behavior are outside
scope. No network, GNOME session, subprocess, or user settings are used.

Raw V8 offsets refer to the adapted VM source, not unchanged production source
line coverage. Passing these unit contracts establishes neither real GTK
rendering nor integration/end-to-end coverage.
