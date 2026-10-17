# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import math
from typing import Any


def element_canvas_bbox(element: dict[str, Any]) -> dict[str, int | float]:
    bbox = {key: element[key] for key in ("x", "y", "width", "height")}
    if element["kind"] != "chart" and not (element["kind"] == "shape" and element["type"] == "text"):
        return bbox

    rotation = element["rotation"]
    if not isinstance(rotation, (int, float)) or not math.isfinite(rotation):
        rotation = 0
    rotation %= 360
    if math.isclose(rotation, 0, abs_tol=1e-9):
        return bbox
    radians = math.radians(rotation)
    sine = abs(math.sin(radians))
    cosine = abs(math.cos(radians))
    sine = 0 if math.isclose(sine, 0, abs_tol=1e-12) else sine
    cosine = 0 if math.isclose(cosine, 0, abs_tol=1e-12) else cosine
    rotated_width = element["width"] * cosine + element["height"] * sine
    rotated_height = element["width"] * sine + element["height"] * cosine
    return {
        "x": element["x"] - (rotated_width - element["width"]) / 2,
        "y": element["y"] - (rotated_height - element["height"]) / 2,
        "width": rotated_width,
        "height": rotated_height,
    }


def detect_elements_out_of_canvas(
    elements: list[dict[str, Any]], slide_width: int | float, slide_height: int | float
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for element in (
        element
        for element in elements
        if element["kind"] in {"table", "chart"}
        or (element["kind"] == "shape" and element["type"] == "text")
    ):
        bbox = element_canvas_bbox(element)
        overflow = {
            "left": max(-bbox["x"], 0),
            "top": max(-bbox["y"], 0),
            "right": max(bbox["x"] + bbox["width"] - slide_width, 0),
            "bottom": max(bbox["y"] + bbox["height"] - slide_height, 0),
        }
        overflow_details = [
            f"{side} by {amount:g}px" for side, amount in overflow.items() if amount > 0
        ]
        if not overflow_details:
            continue
        issues.append(
            {
                "level": "error",
                "code": f'{element["kind"]}_out_of_canvas',
                "elements": [element["id"]],
                "canvas": {"width": slide_width, "height": slide_height},
                "bbox": bbox,
                "overflow": overflow,
                "message": (
                    f'{element["kind"]} {element["id"]} exceeds the {slide_width:g}x{slide_height:g} canvas '
                    f'({", ".join(overflow_details)})'
                ),
                "hint": (
                    "Move the table inside the canvas, reduce table.width/table.height, or split the table across "
                    "slides."
                    if element["kind"] == "table"
                    else f'Move the {element["kind"]} inside the canvas or reduce its width/height.'
                ),
            }
        )
    return issues
