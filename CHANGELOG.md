# Changelog

## @bto-labs/agy-bridge v0.6.1 - 2026-09-05

### Fixed

- `follow_up` now honors an explicit `model` override, validated against the
  model registry like every other tool. Previously the schema advertised
  `model` for `follow_up`, but the handler unconditionally discarded it
  whenever a `session_id` was present, silently deferring to `agy`'s own
  default routing (typically a cheaper, lower-tier model) even when a
  specific model was explicitly requested.
- `follow_up` with no explicit model still continues the existing agy
  session unpinned, exactly as before — this only changes behavior when a
  `model` is actually supplied.
- The follow_up bypass is now scoped to the tool's own identity rather than
  merely "a `session_id` is present," so it can never trigger for a
  different tool.

## @bto-labs/agy-bridge v0.6.0 - 2026-09-03

### Added

- `CooldownRegistry` now shares quota-cooldown state across every concurrent
  agy-bridge process on a host, not just within one — each process runs as a
  separate MCP server instance, and several often share one account's quota.
  A model's cooldown deadline is recorded as the mtime of a marker file under
  `~/.cache/agy-bridge/cooldowns/`; `utimes`/`stat` are single-syscall
  metadata operations, atomic by construction, so no locking or temp-file
  machinery is needed.

### Fixed

- A cooldown can no longer be silently shortened by a later, shorter-duration
  write (e.g. a per-minute rate limit racing a per-day quota exhaustion on
  the same model) — `CooldownRegistry.set()` now only ever extends an
  existing deadline, never retreats it.

## @bto-labs/agy-bridge v0.5.0 - 2026-08-11

Forked and published the package under the BTO Labs npm scope.

### Added

- Scoped package `@bto-labs/agy-bridge` published to npm.
- `publishConfig.access = "public"` in `package.json`.

### Changed

- Renamed package from `agy-bridge` to `@bto-labs/agy-bridge`.
- Updated repository, homepage, and bugs URLs to `https://github.com/bto-labs/agy-bridge`.
- Updated `mcpName` to `io.github.bto-labs.agy-bridge`.
- Updated README and `docs/multi-client-support.md` to use `npx -y @bto-labs/agy-bridge`.
- Updated `glama.json` maintainer to `bto-labs`.
- Bumped MCP server version to `0.5.0`.

### Fixed

- `parseModels` now handles `agy` 1.1.12 tab-separated `cli-id\tDisplay Name` output.
- Both CLI IDs (e.g. `gemini-3.1-pro-high`) and display names (e.g. `Gemini 3.1 Pro (High)`) are accepted.
- Leading `Fetching available models...` status line and trailing ` (current)` marker are skipped.
