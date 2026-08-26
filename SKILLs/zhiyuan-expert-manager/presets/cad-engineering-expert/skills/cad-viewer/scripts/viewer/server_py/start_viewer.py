"""Single-port CAD Viewer launcher (serve mode, Python backend).

Runs the `start` npm script: it starts the Python CAD Viewer backend — which
serves the prebuilt Vite bundle in `dist/` plus the /__cad API — on a single
port (default 3245). If the port is free it starts; if the port is already in
use it exits 1 with a `--port <n>` hint. It does NOT probe-and-reuse a running
Viewer or roll onto another port. Prints the load-bearing stdout contract (the
CAD Viewer URL line + optional --json {url,port,action}).

The Viewer serves no configured directory: a page URL's PATH is the absolute
directory to open, so one Viewer serves any folder without being told about it
up front. The bare origin opens the process cwd.

This is the consumer entry point for running the built Viewer. For local client
iteration in a source checkout use `npm run dev` (Vite/HMR) instead; see the
repo AGENTS.md for the dev-vs-prod and per-worktree port guidance.

Run: python -m server_py.start_viewer [--port N] [--json]
"""

from __future__ import annotations

import argparse
import errno
import json
import os
import socket
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from server_py import cadgen_bridge
    from server_py.paths import url_path_from_filesystem_path
    from server_py.server_info import DEFAULT_VIEWER_PORT, DEFAULT_VIEWER_HOST
else:
    from . import cadgen_bridge
    from .paths import url_path_from_filesystem_path
    from .server_info import DEFAULT_VIEWER_PORT, DEFAULT_VIEWER_HOST

_VIEWER_APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def viewer_url(host: str, port: int, directory: str = "") -> str:
    """The Viewer URL for a directory: the absolute path IS the URL path, exactly as
    in a file:// URL. No directory yields the bare origin, which opens the cwd.

    A Windows path is not already a URL path — pasting `D:\\models` on the end of the
    origin yields `http://127.0.0.1:3245D:\\models`, which is not a URL at all — so the
    absolute path is converted rather than concatenated."""
    path = url_path_from_filesystem_path(os.path.abspath(directory)) if str(directory or "").strip() else ""
    return f"http://{host}:{port}{path or '/'}"


def port_is_free(host: str, port: int) -> bool:
    """True when this process can bind host:port -- the same operation the server
    is about to perform, so the probe cannot disagree with reality.

    This used to probe by CONNECTING, with only ConnectionRefusedError counting
    as free. On Windows a connect to a closed port routinely fails some other
    way (Hyper-V/WSL port exclusions, loopback filtering, refusals arriving as
    timeouts), so every port read as occupied and the launcher refused to start
    with a false "already in use" -- found by #335's Windows smoke, where four
    random ports Python had just bound all "failed" the connect probe.

    A definite EADDRINUSE (and EACCES, Windows's answer for its excluded port
    ranges) keeps the friendly rerun-with---port message. Any other error counts
    as FREE: this probe exists only for that message, and a probe that cannot
    tell must never block a launch -- the server's own bind stays authoritative
    and reports anything genuinely wrong."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((host, port))
        return True
    except OSError as exc:
        return exc.errno not in (errno.EADDRINUSE, errno.EACCES)


def spawn_backend(host: str, port: int):
    """Spawn the Python backend (serves the built dist + /__cad) on host:port."""
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join([_VIEWER_APP_ROOT, env.get("PYTHONPATH", "")]).rstrip(os.pathsep)
    env["VIEWER_CAD_BACKEND_VALIDATED"] = "1"
    cmd = [sys.executable, "-m", "server_py.server", "--host", host, "--port", str(port)]
    return subprocess.Popen(cmd, env=env)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Start the Python CAD Viewer backend on a single port")
    parser.add_argument("--host", default=DEFAULT_VIEWER_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_VIEWER_PORT)
    parser.add_argument("--json", action="store_true", dest="json_result")
    args, _unknown = parser.parse_known_args(argv)

    directory = os.getcwd()
    host, port = args.host, args.port

    if not port_is_free(host, port):
        print(
            f"Port {port} on {host} is already in use. "
            f"Rerun with --port <n> to use a different port.",
            file=sys.stderr,
        )
        return 1

    try:
        cadgen_bridge.require_cadgen_runtime(directory)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    url = viewer_url(host, port, directory)
    print(f"Starting CAD Viewer at {url}")
    print(f"CAD Viewer URL: {url}")
    if args.json_result:
        print(json.dumps({"url": url, "port": port, "action": "start"}))
    sys.stdout.flush()
    child = spawn_backend(host, port)
    return child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
