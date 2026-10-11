# Source schema contracts

Run from the repository root with Python 3 and its standard library:

```sh
python3 -m unittest discover -s tests -p 'test_schema_contracts.py' -v
```

These offline tests read the source XML schema and `metadata.json`. They assert
the schema ID/path, exact unique keys, variant type declarations, position and
refresh defaults/ranges, default watchlist, and language default/choices. They
do not modify the source schema, tracked compiled schema or user settings.

Optional execution counts:

```sh
counts_dir="$(mktemp -d /tmp/stock-schema-counts.XXXXXX)"
python3 -m trace --count --summary --missing \
  --file "$counts_dir/unit.counts" --coverdir "$counts_dir" \
  --module unittest discover -s tests -p 'test_schema_contracts.py'
```

The trace output measures Python test execution, not production XML line
coverage. These are source-declaration contracts, not GLib compilation,
GVariant parsing, real GSettings range enforcement, compiled-schema freshness,
GNOME integration or end-to-end tests. In particular, Python literal parsing
is sufficient for the current defaults but is not a general GVariant parser.
No GNOME session, network access or third-party Python dependency is required.
