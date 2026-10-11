# Command runner tests

Run the dependency-free offline unit suite with Node.js 18 or newer:

```sh
node --test tests/command-runner.test.cjs
```

The suite executes the unchanged `extension.js` module body in a fresh VM
context per test, removing imports and the default-export keyword. Gio process
and cancellation doubles and a manually driven GLib timer map exercise
`SafeCommandRunner` without GNOME Shell, Python, curl, network access or real
subprocesses.

The tests cover process arguments and pipe flags, successful and unsuccessful
results, nullish output, the exact 2 MiB character limit on each stream, spawn
and communication errors, status lookup errors, the 20-second timeout,
cancellation, replacement-request races and repeatable destruction.
Late completions must not clear a replacement request's resources.
The widget, Python fetcher, preferences and real Gio/GLib integration are outside
this suite's scope.

To collect raw V8 unit execution data:

```sh
NODE_V8_COVERAGE="$(mktemp -d /tmp/command-runner-coverage.XXXXXX)" \
    node --test tests/command-runner.test.cjs
```

VM source offsets refer to the import/export-adapted module, not unchanged-source
line coverage. This is unit evidence only; it does not establish end-to-end
coverage or execute real cancellation delivery.
