# Session Handoff — Fork and Publish @bto-labs/agy-bridge

## Session Summary

Forked `sshahzaiib/agy-bridge` to the `bto-labs` GitHub organization, rebranded the package as `@bto-labs/agy-bridge`, and published v0.5.0 to npm. The session also included the model-name parsing fix for `agy` 1.1.12 output.

- Fork: https://github.com/bto-labs/agy-bridge
- Package: https://www.npmjs.com/package/@bto-labs/agy-bridge

## Pending Tasks

- `npm view @bto-labs/agy-bridge` returned 404 briefly after publish; the website shows the package as live, so this appears to be npm registry cache/replication delay. Monitor if it persists.
- Consider setting up an npm publish workflow in `.github/workflows/` if frequent publishes are expected.
- Optionally re-list the package on MCP registries (Glama, mcp.so, etc.) under the new org.

## Session Metadata

- **Date:** 2026-08-11
- **Repo:** /home/jay/dev/util/agy-bridge
- **Remote:** https://github.com/bto-labs/agy-bridge
- **Branch:** main
- **Working tree:** clean
- **Last commit:** `d2a583e` — chore: rebrand fork as @bto-labs/agy-bridge v0.5.0

## Branch Information

- `main` is in sync with `origin/main` on `bto-labs/agy-bridge`.
- The `rebrand/bto-labs` feature branch was merged and deleted.
- `upstream/main` still points to `sshahzaiib/agy-bridge`.

## File Inventory

### Created
- `CHANGELOG.md`
- `docs/handoffs/2026-08-11-fork-and-publish.md`
- `docs/handoffs/NEXT-SESSION.md`

### Modified
- `package.json` — renamed package, updated metadata, added publishConfig
- `package-lock.json` — synced name/version
- `src/models.ts` — fixed two-column model parsing
- `src/server.ts` — bumped MCP version
- `src/tools.ts` — updated `model` description
- `README.md` — rebranded install instructions, badges, links
- `docs/multi-client-support.md` — updated `npx` package references
- `glama.json` — updated maintainer
- `test/models.test.ts` — added two-column output tests

## Original Context

> "lets fork this repo on github bto-labs org public. then publish the pakage so it cab be used identical it it but with a new name using github or npm to host it"

## Next Steps

1. Confirm `npm install @bto-labs/agy-bridge` works after npm replication finishes.
2. Smoke-test the published package: `npx -y @bto-labs/agy-bridge`.
3. Add a GitHub Actions publish workflow if desired.
4. Re-list on MCP directories under `bto-labs` if discoverability matters.
