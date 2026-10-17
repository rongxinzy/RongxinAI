# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

from typing import Any


def intersects(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return (
        left["x"] < right["x"] + right["width"]
        and left["x"] + left["width"] > right["x"]
        and left["y"] < right["y"] + right["height"]
        and left["y"] + left["height"] > right["y"]
    )


def intersection_area(left: dict[str, Any], right: dict[str, Any]) -> int | float:
    width = min(left["x"] + left["width"], right["x"] + right["width"]) - max(left["x"], right["x"])
    height = min(left["y"] + left["height"], right["y"] + right["height"]) - max(left["y"], right["y"])
    if width <= 0 or height <= 0:
        return 0
    return width * height


def intersection_height(left: dict[str, Any], right: dict[str, Any]) -> int | float:
    height = min(left["y"] + left["height"], right["y"] + right["height"]) - max(left["y"], right["y"])
    return max(height, 0)


def intersection_width(left: dict[str, Any], right: dict[str, Any]) -> int | float:
    width = min(left["x"] + left["width"], right["x"] + right["width"]) - max(left["x"], right["x"])
    return max(width, 0)


def element_area(element: dict[str, Any]) -> int | float:
    return max(element["width"], 0) * max(element["height"], 0)


def contains(outer: dict[str, Any], inner: dict[str, Any], tolerance: int | float = 2) -> bool:
    return (
        inner["x"] >= outer["x"] - tolerance
        and inner["y"] >= outer["y"] - tolerance
        and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + tolerance
        and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + tolerance
    )
