# Offline extension entry-point tests

Run from the repository root with Node.js 18 or later:

```sh
node --test tests/extension-entrypoint.test.cjs
```

The suite executes the real `FinancialMarketsExtension.enable` and `disable`
methods from `extension.js` in a fresh VM context per test. Only imports and
default-export syntax are adapted. The registered `StocksWidget` class is
replaced by a recording constructor; the extension base class and console are
doubles. No widget internals, GNOME session, subprocess, network, or user
settings are exercised.

Assertions cover widget ownership, destruction, repeated disable, re-enabling,
construction failure, cleanup of an existing reference after failed construction,
secondary cleanup failure, diagnostic messages, and recovery after failure.
Widget initialization, refresh, rendering, timers, and runner behavior belong
to separate suites.

Collect raw V8 execution data outside the checkout:

```sh
NODE_V8_COVERAGE="$(mktemp -d /tmp/stock-entrypoint-coverage.XXXXXX)" \
    node --test tests/extension-entrypoint.test.cjs
```

The output contains `coverage-*.json` files, including executed `enable` and
`disable` ranges in the adapted VM source. Those offsets are not unchanged-source
line coverage. These are offline unit tests, not integration or end-to-end
tests. The baseline repository documents no integration/end-to-end coverage
source; that coverage remains unknown. Do not merge data from different
revisions or incompatible source adaptations.
