# Manual layout verification

`verify-1280x800-layout.mjs` is a standalone, optional browser harness. It is not
called by daily CI or the release workflow and does not replace the standard
`bun run web:preview:check` suite or manual design review.

After installing the repository dependencies and Playwright Chromium, start the
browser preview in one terminal:

```sh
bun run web:preview
```

With that server running, launch the harness from the repository root:

```sh
node scripts/preview/verify-1280x800-layout.mjs
```

It uses `http://127.0.0.1:5176/` by default. If the preview server selected a
different port, set `PREVIEW_PORT` to that port when running the command. The
harness uses a 1280×800 viewport in light and dark modes and reports its layout
assertions and captured browser errors. A failing assertion or browser exception
returns a nonzero exit code.

The harness requires the browser mock's expected session and navigation fixtures.
Its output covers only the checks implemented in the script, not full UI,
Electron, installer, or release acceptance. Adding the documented standalone
entry to Knip keeps the script and its dependency graph checked; it does not
record a successful browser run.
