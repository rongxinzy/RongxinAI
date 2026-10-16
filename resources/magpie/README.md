# Bundled Magpie CLI runtime

Magpie is built directly from the unchanged upstream Go source at
`f074996d93b87b17ea682c4b5951d52794bb28cb` in
<https://github.com/yetone/magpie>. Its MIT license is retained verbatim in
`LICENSE` and in every generated platform directory. The application integrates
the resulting sidecar; it does not port or modify upstream Go source.

## Build

Install the official **Go 1.26.8** SDK manually from <https://go.dev/dl/>.
`upstream.json` records the official archive SHA-256 for each supported host.
Verify the downloaded SDK against that checksum before using it. A command named
`go` is insufficient: the builder checks the exact SDK version and disables Go's
automatic toolchain download. Git and tar must also be available.

```sh
bun run magpie:build --target all --go /path/to/go
bun run magpie:verify --target all
```

The build fetches only the pinned commit. To use an existing clean upstream Git
checkout without fetching, add `--source /path/to/magpie`. The checkout is read
only. The builder verifies its commit tree, deterministic Git archive checksum,
go.mod, go.sum, and MIT license; it builds an extracted snapshot and verifies that
no snapshot file changed. No patch, `go mod tidy`, install script, account
configuration, daemon, or upstream binary is run.

The six targets are `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
`win32-x64`, and `win32-arm64`; `--target` selects one or `all`. No argument selects
the current host. Node `x64` maps to Go `amd64`, and Node `win32` maps to Go
`windows`. Both macOS helpers are needed for macOS packaging, including a
single-architecture build, so universal packages retain the same unchanged
per-architecture payloads instead of lipo-merging them.

Build outputs go to `resources/magpie/<platform>-<arch>/`. They are ignored by
Git; release builds must create them before running electron-builder. Missing,
wrong-version, unsupported, or hash-mismatched resources fail packaging with an
explicit error. Packaging and application startup never download a replacement.

## Reproducibility and provenance

The builder mirrors upstream's CLI Makefile flags: `CGO_ENABLED=0`, `-tags nogui`,
`-trimpath`, and `-ldflags '-s -w -X main.version=zhiyuan-f074996d93b8'`. The
version is a downstream provenance label, not an upstream release tag.
`-mod=readonly`, `-buildvcs=false`, `GOWORK=off`, fixed CPU baselines, and a clean
Go environment additionally remove checkout paths, ambient workspaces and local
build flags. Dependencies stay at the pinned go.mod/go.sum versions and use the
official Go module proxy and checksum database.

Each manifest records the source commit/tree/archive and content hashes,
go.mod/go.sum hashes, exact compiler version and build flags, binary SHA-256,
size, and MIT license hash. It has no timestamps or build-machine paths, so
rebuilding the same target can be compared byte-for-byte. `buildSha256` always
identifies the compiler output; `sha256` identifies the shipped executable.
These hashes protect integrity against accidental replacement. A manifest beside
a binary is not an independent authenticity signature.

Mac codesigning changes executable bytes. The custom signing hook preserves the
electron-builder identity/keychain/entitlement options, signs child binaries via
`@electron/osx-sign`, refreshes shipped hashes just before the final outer `.app`
signature, and retains `buildSha256`. Universal packaging explicitly excludes
these already per-architecture helpers from lipo. Windows packaging preserves the
compiled helper bytes rather than applying the application's Authenticode pass.
The enclosing Windows installer can still be signed. Validate signed macOS and
Windows installers on their native operating systems before release; Linux
cross-compilation alone does not establish codesign, Gatekeeper, or installer
acceptance.

The upstream MIT notice does not replace the licensing obligations of Go's
statically linked dependencies. Release distributors should include their normal
third-party dependency notices with the application.
