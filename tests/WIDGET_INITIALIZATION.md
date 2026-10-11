# Offline widget initialization tests

Run from the repository root with Node.js 18 or later:

```sh
node --test tests/widget-initialization.test.cjs
```

The suite evaluates the real `extension.js` module body in fresh VM contexts,
removing only imports and default-export syntax. It exercises
`StocksWidget._init`, `_updatePosition`, `_intervalMs` and the initialization
callbacks for settings and monitor changes. GNOME actors, settings, layout
signals and translation are doubles. UI construction, refresh, row rendering,
error display and runner cancellation are replaced with recording doubles.
No network, subprocess or GNOME session is used.

Assertions cover initialization order, monitor selection and missing-monitor
handling, current offsets and refresh interval, position-only changes,
generation invalidation, cancellation and backoff reset before refresh,
symbol-change clearing and language-dependent title, timestamp and formatters.
Refresh/backoff implementation, runner lifecycle, teardown, real rendering
and preferences belong to separate suites.

Collect raw V8 execution data outside the checkout:

```sh
NODE_V8_COVERAGE="$(mktemp -d /tmp/widget-initialization-coverage.XXXXXX)" \
    node --test tests/widget-initialization.test.cjs
```

The output contains `coverage-*.json` files. Import-adapted VM source offsets
are not unchanged-source line coverage. These are offline unit tests, not
integration or end-to-end tests. The base repository configures no integration
or end-to-end coverage source; that coverage remains unknown. Do not combine
raw data from different code revisions or incompatible source adaptations.
