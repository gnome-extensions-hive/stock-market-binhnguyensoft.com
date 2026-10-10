# Preferences About contracts

Run the dependency-free offline suite with Node.js:

```sh
node --test tests/prefs-about.test.cjs
```

Collect raw V8 execution data outside the checkout:

```sh
NODE_V8_COVERAGE="$(mktemp -d /tmp/stock-prefs-about-coverage.XXXXXX)" \
    node --test tests/prefs-about.test.cjs
```

The suite executes `prefs.js` in fresh VM contexts, adapting only imports and
the default-export declaration. GTK buttons, libadwaita headers and About
presentations are controlled doubles. No network, user settings, or live GNOME
session is required.

Contracts cover `_findHeaderBar` depth-first traversal, `_addAboutButton`
idempotence and click wiring, and `_showAbout` metadata defaults, version-name
precedence, issue URL normalization, modern AboutDialog and legacy AboutWindow
presentation, and error propagation. Watchlist editing, preferences-window
construction and idle scheduling belong to separate suites.

Raw V8 offsets describe adapted VM source, not unchanged-source line coverage.
These tests do not establish integration or end-to-end coverage or validate
real libadwaita rendering.
