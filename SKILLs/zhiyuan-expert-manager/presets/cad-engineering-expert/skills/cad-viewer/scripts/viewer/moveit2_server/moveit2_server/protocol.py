from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Any


SUPPORTED_REQUEST_TYPES = {"srdf.solvePose", "srdf.planToPose"}
SUPPORTED_PROTOCOL_VERSION = 1
_ABSOLUTE_PATH_RE = re.compile(r"(?<![\w.])/(?:[^\s'\"<>:,;(){}[\]]+/)+[^\s'\"<>:,;(){}[\]]+")


class MotionProtocolError(ValueError):
    """Raised when a MoveIt2 server request is malformed."""


def _plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def _string(value: Any, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise MotionProtocolError(f"{label} is required")
    return normalized


def _number(value: Any, label: str) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise MotionProtocolError(f"{label} must be a finite number") from exc
    if numeric != numeric or numeric in (float("inf"), float("-inf")):
        raise MotionProtocolError(f"{label} must be a finite number")
    return numeric


def normalize_xyz(value: Any, label: str = "target.xyz") -> tuple[float, float, float]:
    if not isinstance(value, list) or len(value) != 3:
        raise MotionProtocolError(f"{label} must be a 3-number array")
    return (
        _number(value[0], f"{label}[0]"),
        _number(value[1], f"{label}[1]"),
        _number(value[2], f"{label}[2]"),
    )


def normalize_quat_xyzw(value: Any, label: str = "target.quat_xyzw") -> tuple[float, float, float, float]:
    if not isinstance(value, list) or len(value) != 4:
        raise MotionProtocolError(f"{label} must be a 4-number array")
    quat = (
        _number(value[0], f"{label}[0]"),
        _number(value[1], f"{label}[1]"),
        _number(value[2], f"{label}[2]"),
        _number(value[3], f"{label}[3]"),
    )
    norm = math.sqrt(sum(component * component for component in quat))
    if norm <= 1e-12:
        raise MotionProtocolError(f"{label} must not be zero length")
    return tuple(component / norm for component in quat)


def normalize_rpy(value: Any, label: str = "target.rpy") -> tuple[float, float, float]:
    if not isinstance(value, list) or len(value) != 3:
        raise MotionProtocolError(f"{label} must be a 3-number array")
    return (
        _number(value[0], f"{label}[0]"),
        _number(value[1], f"{label}[1]"),
        _number(value[2], f"{label}[2]"),
    )


def _quat_xyzw_from_rpy(roll: float, pitch: float, yaw: float) -> tuple[float, float, float, float]:
    cy = math.cos(yaw * 0.5)
    sy = math.sin(yaw * 0.5)
    cp = math.cos(pitch * 0.5)
    sp = math.sin(pitch * 0.5)
    cr = math.cos(roll * 0.5)
    sr = math.sin(roll * 0.5)
    return normalize_quat_xyzw([
        (sr * cp * cy) - (cr * sp * sy),
        (cr * sp * cy) + (sr * cp * sy),
        (cr * cp * sy) - (sr * sp * cy),
        (cr * cp * cy) + (sr * sp * sy),
    ])


def normalize_joint_values(value: Any, label: str = "startJointValuesByNameDeg") -> dict[str, float]:
    if value is None:
        return {}
    if not _plain_object(value):
        raise MotionProtocolError(f"{label} must be an object")
    normalized: dict[str, float] = {}
    for raw_name, raw_value in value.items():
        name = str(raw_name or "").strip()
        if not name:
            raise MotionProtocolError(f"{label} cannot include empty joint names")
        normalized[name] = _number(raw_value, f"{label}.{name}")
    return normalized


def normalize_protocol_version(value: Any) -> int:
    if value is None:
        return SUPPORTED_PROTOCOL_VERSION
    try:
        version = int(value)
    except (TypeError, ValueError) as exc:
        raise MotionProtocolError("protocolVersion must be an integer") from exc
    if version != SUPPORTED_PROTOCOL_VERSION:
        raise MotionProtocolError(f"Unsupported protocolVersion {version}")
    return version


@dataclass(frozen=True)
class WireMessage:
    id: str
    type: str
    protocol_version: int
    payload: dict[str, Any]


@dataclass(frozen=True)
class MotionRequest:
    id: str
    type: str
    protocol_version: int
    payload: dict[str, Any]
    context: dict[str, Any]
    command: dict[str, Any]


def normalize_wire_message(message: Any) -> WireMessage:
    if not _plain_object(message):
        raise MotionProtocolError("MoveIt2 request must be an object")
    request_id = _string(message.get("id"), "id")
    request_type = _string(message.get("type"), "type")
    protocol_version = normalize_protocol_version(message.get("protocolVersion"))
    if request_type not in SUPPORTED_REQUEST_TYPES:
        raise MotionProtocolError(f"Unsupported request type {request_type}")
    payload = message.get("payload")
    if not _plain_object(payload):
        raise MotionProtocolError("payload must be an object")
    return WireMessage(
        id=request_id,
        type=request_type,
        protocol_version=protocol_version,
        payload=payload,
    )


def normalize_request(message: Any, *, context: dict[str, Any]) -> MotionRequest:
    wire = normalize_wire_message(message)
    if not _plain_object(context):
        raise MotionProtocolError("request context must be an object")
    command = context.get("command")
    if not _plain_object(command):
        raise MotionProtocolError("request context command must be an object")
    return MotionRequest(
        id=wire.id,
        type=wire.type,
        protocol_version=wire.protocol_version,
        payload=wire.payload,
        context=context,
        command=command,
    )


def normalize_motion_target(payload: dict[str, Any]) -> dict[str, Any]:
    target = payload.get("target")
    if not _plain_object(target):
        raise MotionProtocolError("target must be an object")
    has_quat = "quat_xyzw" in target
    has_rpy = "rpy" in target
    if has_quat and has_rpy:
        raise MotionProtocolError("target must include exactly one of quat_xyzw or rpy")
    quat_xyzw: tuple[float, float, float, float] | None = None
    orientation_mode = "position_only"
    if has_quat:
        quat_xyzw = normalize_quat_xyzw(target.get("quat_xyzw"))
        orientation_mode = "quat_xyzw"
    elif has_rpy:
        quat_xyzw = _quat_xyzw_from_rpy(*normalize_rpy(target.get("rpy")))
        orientation_mode = "rpy"
    return {
        "endEffector": _string(target.get("endEffector"), "target.endEffector"),
        "frame": _string(target.get("frame"), "target.frame"),
        "xyz": normalize_xyz(target.get("xyz")),
        "quat_xyzw": quat_xyzw,
        "orientationMode": orientation_mode,
    }


def success_response(request_id: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": request_id,
        "ok": True,
        "result": result,
    }


def _sanitize_error_message(message: str) -> str:
    def replace(match: re.Match[str]) -> str:
        path = match.group(0)
        basename = path.rstrip("/").rsplit("/", 1)[-1]
        return f".../{basename}" if basename else "<path>"

    return _ABSOLUTE_PATH_RE.sub(replace, message)


def error_response(request_id: str, error: BaseException, *, debug: bool = False) -> dict[str, Any]:
    message = str(error)
    if not debug:
        message = _sanitize_error_message(message)
    return {
        "id": request_id,
        "ok": False,
        "error": {
            "code": error.__class__.__name__,
            "message": message,
        },
    }
