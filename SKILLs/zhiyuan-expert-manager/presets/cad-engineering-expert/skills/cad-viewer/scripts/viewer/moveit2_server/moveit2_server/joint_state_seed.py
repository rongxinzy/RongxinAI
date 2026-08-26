from __future__ import annotations

import argparse
import json
import time
from typing import Any


def _json_list(value: str, label: str) -> list[Any]:
    payload = json.loads(value)
    if not isinstance(payload, list):
        raise ValueError(f"{label} must be a JSON array")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m moveit2_server.joint_state_seed")
    parser.add_argument("--names", required=True, help="JSON array of joint names")
    parser.add_argument("--positions", required=True, help="JSON array of joint positions in ROS units")
    parser.add_argument("--duration", type=float, default=8.0)
    parser.add_argument("--rate", type=float, default=30.0)
    args = parser.parse_args(argv)

    names = [str(name) for name in _json_list(args.names, "names")]
    positions = [float(position) for position in _json_list(args.positions, "positions")]
    if len(names) != len(positions):
        raise ValueError("names and positions must have the same length")
    if args.duration <= 0 or args.rate <= 0:
        raise ValueError("duration and rate must be positive")

    import rclpy
    from sensor_msgs.msg import JointState

    rclpy.init(args=None)
    node = rclpy.create_node("moveit2_server_joint_state_seed")
    publisher = node.create_publisher(JointState, "/joint_states", 10)
    deadline = time.monotonic() + args.duration
    period = 1.0 / args.rate
    try:
        while time.monotonic() < deadline and rclpy.ok():
            message = JointState()
            message.header.stamp = node.get_clock().now().to_msg()
            message.name = names
            message.position = positions
            publisher.publish(message)
            rclpy.spin_once(node, timeout_sec=0.0)
            time.sleep(period)
    finally:
        try:
            node.destroy_node()
        except Exception:
            pass
        try:
            rclpy.shutdown()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
