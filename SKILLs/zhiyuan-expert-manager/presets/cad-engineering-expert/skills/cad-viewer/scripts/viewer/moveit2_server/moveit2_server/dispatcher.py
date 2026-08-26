from __future__ import annotations

from functools import lru_cache
from typing import Any

from moveit2_server.protocol import MotionProtocolError, MotionRequest
from moveit2_server.moveit_py import MoveItPyAdapter


@lru_cache(maxsize=1)
def _adapter() -> MoveItPyAdapter:
    return MoveItPyAdapter()


def dispatch(request: MotionRequest) -> dict[str, Any]:
    adapter = _adapter()
    if request.type == "srdf.solvePose":
        result = adapter.solve_pose(request)
    elif request.type == "srdf.planToPose":
        result = adapter.plan_to_pose(request)
    else:
        raise MotionProtocolError(f"Unsupported request type {request.type}")

    if not isinstance(result, dict):
        raise MotionProtocolError("MoveIt2 adapter result must be an object")
    if result.get("ok") is False:
        raise RuntimeError(str(result.get("message") or "MoveIt2 request failed"))
    result.pop("ok", None)
    return result
