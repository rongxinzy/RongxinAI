# Upstream Markdown memory extension

This directory vendors the published `@sigrun/memory-markdown@0.3.1` Pi Durable
extension with packaging, declaration and canonical-write patches. It is an upstream ecosystem
plugin, not an application-authored memory engine. Five upstream JavaScript implementation files are retained byte for byte.
Only `dist/files.js` changes, through the exact checked-in
`canonical-atomic-write.patch.json` replacements.

- Upstream: <https://github.com/sigrun-ai/sigrun-memory-markdown>
- Published package: <https://registry.npmjs.org/@sigrun/memory-markdown/-/memory-markdown-0.3.1.tgz>
- Upstream revision inspected: `ee4c766e852bdd81fceec0250eecc838cfdcb492`.
- Official npm integrity: `sha512-8iEOIhU7ZS+Bvut8e43sc+YAM7QaogieGRSZTSrLKI53F2hmCOhktxmq7laNhC3rc07qBbYV4i4FIKM47tDixA==`.
- Original archive SHA-256: `8af1c9969218ecda6a5514942a8973846c4a14aa43219a52458e8d2dbe695e83`.
- Patched archive SHA-256: `305f1ca30f7fb07c301355344729528f2b8e50442e623ee79ee5d2856a9efd09`.
- License: MIT; the original license is retained inside both archives.

The package declares the Sigrun server as a peer, although every server import
is erased from its emitted JavaScript. Installing that peer would introduce a
separate server and its transitive dependencies. The patch marks only that peer
optional. Two declaration imports are redirected to the checked-in structural
host types, avoiding a type dependency on the server. The host supplies settings,
an owner-bound data path and conversation-owner resolution. No server code or
replacement runtime is included.

Reproduce with the repository's Node 24 toolchain:

```sh
node scripts/vendor-memory-markdown.mjs --build
node scripts/vendor-memory-markdown.mjs --verify
```

The script verifies the original npm SHA-512, changes the package manifest
and two declaration imports, adds the host declaration, applies the exact
canonical-write replacements, and emits a deterministic `zhiyuan.2` archive.
Verification compares the resulting archive, checks `files.js` against exactly
that patch, and proves every other JavaScript file matches the official package. The original
archive is retained so verification works offline.

The application must bind each extension to an explicit project or personal
scope. The plugin registers a writable native tool; the host must apply its
memory-confirmation policy before exposing that tool to an ordinary run.
File versions and undo remain upstream implementations. The sole JavaScript
patch replaces both `apply` and `undo` canonical writes with an exclusive unique
staging file in the same directory, `writeFile(..., {flush: true})`, then `rename`
over the canonical file. A write/rename exception cleans the staging file and
keeps the old canonical bytes. A forced kill before rename can leave an orphan
staging file; readers never treat it as canonical, and hard deletion clears its
owner's orphan staging files as well as versions. This prevents process-crash
truncation; it is not a transaction across Markdown and the application's SQLite
projection, nor a claim about storage hardware surviving power loss.

The patch does not change the upstream per-owner queue, file limits, operations,
curation logic or ownership. `src/main/memory/markdownMemoryAtomicWrite.test.ts`
uses separate real Node processes to inject partial-write and rename failures,
SIGKILL immediately before rename, reopen successful replacements, and verify
undo follows the same atomic path. The patch is kept as explicit before/after
text so it can be adapted into an upstream contribution without extracting our
application's governance code.
