# Windows signing policy

Application, installer and Magpie signing use the existing Certum SimplySign
certificate. The shared SignTool command is [sign-windows-file.ps1](../sign-windows-file.ps1).
It validates the configured certificate thumbprint, private-key availability
and expiry, then signs with SHA-256 and an RFC3161 timestamp. A failed signing
command fails the build.

The installer shell additionally verifies the signer and timestamp in
[sign-shell.ps1](../installer-shell/sign-shell.ps1). Magpie signing remains in
the packaging hook: after signing the executable, the hook updates its sealed
manifest. Signed-release acceptance verifies both the helper's signature and
its sealed digest.

Long-term memory is stored by the upstream Durable Markdown plugin; SQLite
retains product governance and checkpoints. No separately downloaded executable,
binary signing workflow or packaged memory sidecar is required.
The retired sidecar-runtime signing dispatch and cross-repository artifact
provenance scripts have been removed.

Offline component archive hashes, sentinel hashes, installed-file checks and
clean-PATH execution smoke tests remain part of package acceptance. Policy
tests check the wiring; they do not establish that cloud signing or a native
Windows installation has been performed.
