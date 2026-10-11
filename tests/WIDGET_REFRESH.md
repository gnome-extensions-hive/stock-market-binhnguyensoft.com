# Offline widget refresh tests

Run from the repository root with Node.js 18 or later:

```sh
node --test tests/widget-refresh.test.cjs
```

The tests evaluate the real `extension.js` module body in a fresh VM context
per test, removing only its imports and default-export syntax. GNOME adapters,
subprocess responses, timers, row rendering and error display are doubles.
The real `StocksWidget._refresh`, `_scheduleNext`, `_scheduleFailure` and
`destroy` methods execute without a GNOME session, network or subprocess.

Assertions cover successful, partial, cached, empty and invalid responses;
last-valid-data retention; cancellation; stale asynchronous results; retry
intervals and backoff caps; timer replacement; and idempotent teardown.
These are unit tests, not GNOME integration or end-to-end tests. UI construction,
actual rendering, settings-change callbacks and `SafeCommandRunner` are outside
this suite.

To collect raw V8 execution data outside the checkout:

```sh
NODE_V8_COVERAGE="$(mktemp -d /tmp/widget-refresh-coverage.XXXXXX)" \
    node --test tests/widget-refresh.test.cjs
```

V8 writes `coverage-*.json` files into that directory. The evaluated source
has imports removed, so its line offsets differ from the original module.
Do not interpret those offsets as unchanged-source line coverage or combine
them with another revision's coverage. No integration/end-to-end coverage
source is configured in the base repository.
