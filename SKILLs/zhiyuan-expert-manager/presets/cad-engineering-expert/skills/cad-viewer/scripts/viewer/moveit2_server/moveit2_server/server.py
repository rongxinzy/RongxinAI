from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import os
from pathlib import Path
from typing import Any

from moveit2_server.context import DEFAULT_CAD_DIRECTORY, build_moveit2_context
from moveit2_server.dispatcher import dispatch
from moveit2_server.protocol import error_response, normalize_request, normalize_wire_message, success_response


def _json_dumps(message: dict[str, Any]) -> str:
    return json.dumps(message, separators=(",", ":"))


async def handle_message(raw_message: str, *, repo_root: Path) -> str:
    request_id = ""
    debug_errors = os.environ.get("MOVEIT2_SERVER_DEBUG_ERRORS", "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        message = json.loads(raw_message)
        wire = normalize_wire_message(message)
        request_id = wire.id
        payload_dir = wire.payload.get("dir", DEFAULT_CAD_DIRECTORY)
        context = build_moveit2_context(
            repo_root=repo_root,
            dir=payload_dir,
            file=wire.payload.get("file"),
            type=wire.type,
            payload=wire.payload,
        )
        request = normalize_request(message, context=context)
        return _json_dumps(success_response(request.id, dispatch(request)))
    except Exception as exc:
        return _json_dumps(error_response(request_id, exc, debug=debug_errors))


async def handle_client(websocket: Any, path: str | None = None, *, repo_root: Path) -> None:
    async for raw_message in websocket:
        await websocket.send(await handle_message(str(raw_message), repo_root=repo_root))


async def run_server(*, repo_root: Path, host: str, port: int) -> None:
    try:
        from websockets.asyncio.server import serve
    except ImportError:
        from websockets import serve

    async with serve(lambda websocket, path=None: handle_client(websocket, path, repo_root=repo_root), host, port):
        print(f"moveit2_server listening on ws://{host}:{port}/ws", flush=True)
        await asyncio.Future()


def _check_import(module_name: str, attribute_path: str | None = None) -> str:
    module = importlib.import_module(module_name)
    current: Any = module
    if attribute_path:
        for attribute in attribute_path.split("."):
            current = getattr(current, attribute)
    return str(getattr(module, "__file__", "built-in"))


def check_environment(*, repo_root: Path) -> dict[str, Any]:
    checks = {
        "repoRoot": str(repo_root),
        "rmwImplementation": os.environ.get("RMW_IMPLEMENTATION", ""),
        "imports": {
            "websockets": _check_import("websockets"),
            "rclpy": _check_import("rclpy"),
            "geometry_msgs.msg.PoseStamped": _check_import("geometry_msgs.msg", "PoseStamped"),
            "moveit.planning.MoveItPy": _check_import("moveit.planning", "MoveItPy"),
        },
    }
    return checks


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="moveit2_server")
    parser.add_argument(
        "--repo-root",
        default=str(Path.cwd()),
        help="Repository root that contains the CAD scan directory.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify required Python, ROS 2, MoveIt, and websocket imports, then exit.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    if args.check:
        print(json.dumps(check_environment(repo_root=repo_root), indent=2, sort_keys=True))
        return 0
    asyncio.run(run_server(repo_root=repo_root, host=args.host, port=args.port))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
