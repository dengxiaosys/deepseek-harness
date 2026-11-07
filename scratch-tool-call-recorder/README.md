# DSH tool call recorder

This out-of-tree Cordis plugin records every final Session-owned tool call and maintains per-tool counts. It is intentionally kept outside `packages/` because it is a deployment-specific third-party plugin, not an official DeepSeek Harness package.

The Web client also adds a **Tool calls** conversation tab. The existing Session list selects which Session the tab displays, so switching Sessions changes the dashboard without mixing counters. The dashboard receives only aggregate counts from a Session projection; raw arguments and results stay in the private Host output directory.

## Output

The default [patch](cordis.patch.yml) writes under this package's ignored `records/` directory:

```text
records/
  session-<hash>/
    calls/
      <sequence>-<uuid>.json
    summary.json
```

Each call file contains the Session id, call ids, tool name, root or nested dispatch, input, and final success or failure output. `summary.json` contains total and per-tool call, success, and failure counts. A new plugin instance rebuilds the summary and sequence from valid call files.

Arguments and results are stored without redaction and can contain credentials or private data. The plugin creates new directories with mode `0700` and files with mode `0600` on POSIX systems, but the deployment owner remains responsible for access, retention, and cleanup.

## Build and load

Run `pnpm install` and then `pnpm run build` in this directory. Development dependencies link to the current DeepSeek Harness checkout, while Agent, Tools, and Cordis remain Host-provided peer dependencies. The package exposes [cordis.patch.yml](cordis.patch.yml) as its DSH bundle patch; the patch inserts `dsh-tool-call-recorder` and configures an absolute `outputDirectory`.

The plugin must load beside the DSH Agent and tools services. It observes final `tools/result` events, ignores calls without an Agent, records nested PTC calls, and drains accepted writes during unload. Persistence failures emit Host warnings without changing the already-final tool result.

The same bundle registers a `toolCallStats` Session projection. It folds durable root calls and nested PTC dispatches, rebuilds historical counts when a Session opens, and publishes a complete value for the selected Session. The projection and audit files have separate responsibilities: the projection serves the dashboard, while files retain full private inputs and outputs.

## Test

Run `pnpm test` in this directory. The tests cover audit records, reload reconstruction, concurrent Sessions, projection isolation, nested calls, dashboard states, filesystem permissions, malformed records, and fail-open persistence.
