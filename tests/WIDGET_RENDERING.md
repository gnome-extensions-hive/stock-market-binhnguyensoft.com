# Offline widget rendering contracts

Run with Node.js 18 or later from the repository root:

```sh
node --test tests/widget-rendering.test.cjs
```

The tests execute `extension.js` in fresh VM contexts, adapting only import
and default-export syntax. Actor doubles record construction, child replacement,
dimensions and text alignment. The financial formatters use Node's real `Intl`
implementation with English and Vietnamese locale data.

The scope is `numberFormatters`, `validFinite`, `formatNumber`, `formatSigned`,
`formatPct`, `makeLabel`, `StocksWidget._buildUi` and `_renderRows`. Assertions
cover finite-value limits, missing values, share/index precision, sign and
percentage conventions, localized labels, actor ordering, row styles and
directions, alignment, replacement and empty states.

These are offline unit contracts, not real GNOME actor layout, visual snapshots,
translation-helper tests, refresh/payload validation or end-to-end coverage.
They require no network, subprocess or user settings.

Collect raw V8 execution data separately:

```sh
coverage_dir="$(mktemp -d /tmp/stock-widget-rendering-coverage.XXXXXX)"
NODE_V8_COVERAGE="$coverage_dir" node --test tests/widget-rendering.test.cjs
```

The JSON includes ranges for the import/export-adapted VM source. Those offsets
are not unchanged-source line coverage. No integration/E2E coverage or combined
coverage percentage is implied.
