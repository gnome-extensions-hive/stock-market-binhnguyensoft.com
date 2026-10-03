# Preferences watchlist tests

Run the dependency-free offline suite with Node.js:

```sh
node --test tests/prefs-watchlist.test.cjs
```

Collect raw V8 unit execution data outside the checkout:

```sh
NODE_V8_COVERAGE="$(mktemp -d /tmp/prefs-watchlist-coverage.XXXXXX)" \
    node --test tests/prefs-watchlist.test.cjs
```

The suite executes `prefs.js` in a fresh VM context for each test. Only import
declarations and the default-export declaration are adapted for Node. GNOME
widgets, settings, translation, and idle scheduling are test doubles; no live
GNOME session or network is used.

Tests exercise symbol normalization and validation, the 20-symbol limit,
duplicate rejection, explicit draft/save persistence, failed-write retry,
editing and cancellation, active-edit guards, reordering and deletion,
language-change page rebuilds, and close-request listener cleanup. About-dialog
behavior, real GTK/GSettings bindings, translations, and widget refresh are
outside this suite.

Raw V8 offsets refer to the adapted VM source, not unchanged-source line
coverage. This suite does not establish integration or end-to-end coverage.
