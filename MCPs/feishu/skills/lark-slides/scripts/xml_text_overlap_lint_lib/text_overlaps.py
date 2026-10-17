# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

from typing import Any

from .elements import has_text_content, is_text_element, is_vertical_text
from .geometry import intersection_area, intersection_height, intersects
from .text_metrics import (
    estimate_text_line_count,
    estimate_text_line_count_for_text,
    estimate_text_line_height,
    estimate_text_max_line_width,
    estimate_text_visual_bbox,
    is_similar_text_overlay,
)


def is_template_text_stack(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if not (is_text_element(left) and is_text_element(right)):
        return False
    if not (has_text_content(left) and has_text_content(right)):
        return True
    top, bottom = sorted([left, right], key=lambda element: element["y"])
    top_type = top.get("textType")
    bottom_type = bottom.get("textType")
    allowed_pairs = {
        ("title", "sub-headline"),
        ("title", None),
        ("headline", "headline"),
        ("headline", None),
    }
    if (top_type, bottom_type) not in allowed_pairs:
        return False
    same_column = abs(top["x"] - bottom["x"]) <= 4
    vertical_offset = bottom["y"] - top["y"]
    top_font_size = float(top.get("fontSize", 16))
    return same_column and vertical_offset >= top_font_size * 0.75


def should_flag_horizontal_text_overflow(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if not (is_text_element(left) and is_text_element(right)):
        return False
    if not (has_text_content(left) and has_text_content(right)):
        return False
    if is_template_text_stack(left, right) or is_similar_text_overlay(left, right):
        return False

    source, target = sorted([left, right], key=lambda element: element["x"])
    if source["x"] == target["x"]:
        return False
    wrap_enabled = source.get("wrap") not in {"false", "0"}
    has_horizontal_gap = source["x"] + source["width"] <= target["x"]
    if wrap_enabled and has_horizontal_gap:
        return False
    if source.get("autoFit") == "normal-auto-fit":
        return False
    if source.get("textAlign") in {"center", "right"}:
        return False

    font_size = source["fontSize"] if isinstance(source["fontSize"], (int, float)) else 16
    visual_width = estimate_text_max_line_width(source)
    overflow_width = visual_width - source["width"]
    min_overflow = max(font_size * 1.5, source["width"] * 0.08)
    if overflow_width < min_overflow:
        return False

    intrusion_width = source["x"] + visual_width - target["x"]
    min_intrusion = max(font_size * 1.5, target["width"] * 0.08)
    if intrusion_width < min_intrusion:
        return False

    vertical_overlap = intersection_height(source, target)
    min_vertical_overlap = min(source["height"], target["height"]) * 0.40
    return vertical_overlap >= min_vertical_overlap


def should_flag_overlap(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if is_text_element(left) and not has_text_content(left):
        return False
    if is_text_element(right) and not has_text_content(right):
        return False
    if is_template_text_stack(left, right):
        return False
    if is_text_element(left) and is_text_element(right):
        if is_similar_text_overlay(left, right):
            return False
        left_visual = estimate_text_visual_bbox(left)
        right_visual = estimate_text_visual_bbox(right)
        if left_visual is None or right_visual is None:
            return False
        overlap_area = intersection_area(left_visual, right_visual)
        if overlap_area <= 0:
            return False
        smaller_area = min(
            left_visual["width"] * left_visual["height"],
            right_visual["width"] * right_visual["height"],
        )
        return smaller_area > 0 and overlap_area / smaller_area >= 0.30
    return False


def detect_image_text_occlusions(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    text_elements = [element for element in elements if is_text_element(element) and has_text_content(element)]
    image_elements = [element for element in elements if element["kind"] == "img" and element["alpha"] > 0]
    for text_element in text_elements:
        for image_element in image_elements:
            if image_element["order"] <= text_element["order"]:
                continue
            if is_vertical_text(text_element):
                if intersects(image_element, text_element):
                    issues.append({
                        "level": "info",
                        "code": "image_may_cover_vertical_text",
                        "elements": [image_element["id"], text_element["id"]],
                        "message": f'image {image_element["id"]} may cover vertical text shape {text_element["id"]}',
                        "hint": "Inspect the rendered slide because vertical text layout is not statically modeled.",
                    })
                continue
            text_visual_bbox = estimate_text_visual_bbox(text_element)
            if text_visual_bbox is not None and intersects(image_element, text_visual_bbox):
                issues.append({
                    "level": "error",
                    "code": "image_covers_text",
                    "elements": [image_element["id"], text_element["id"]],
                    "message": f'image {image_element["id"]} covers text shape {text_element["id"]}',
                    "hint": "Move the image before the text shape in XML order, or adjust the image and text shape coordinates or dimensions.",
                })
    return issues


def detect_text_may_overflow_shapes(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for element in elements:
        if not is_text_element(element) or not has_text_content(element):
            continue
        if element.get("autoFit") in {"normal-auto-fit", "shape-auto-fit"}:
            continue

        font_size = element["fontSize"] if isinstance(element["fontSize"], (int, float)) else 16
        paragraphs = element.get("paragraphs") or [
            {
                "text": element["text"],
                "lineSpacing": None,
                "beforeLineSpacing": None,
                "afterLineSpacing": None,
            }
        ]
        line_count = 0
        estimated_height = 0.0
        line_heights: list[int | float] = []
        for paragraph in paragraphs:
            paragraph_line_count = estimate_text_line_count_for_text(element, paragraph["text"])
            if paragraph_line_count == 0:
                continue
            line_height = estimate_text_line_height(element, paragraph["lineSpacing"] or element["lineSpacing"])
            before_spacing = estimate_text_line_height(
                element, paragraph["beforeLineSpacing"] or element["beforeLineSpacing"] or "fixed:0"
            )
            after_spacing = estimate_text_line_height(
                element, paragraph["afterLineSpacing"] or element["afterLineSpacing"] or "fixed:0"
            )
            if line_height is None or before_spacing is None or after_spacing is None:
                line_count = 0
                break
            first_line_height = font_size if line_count == 0 else line_height
            line_count += paragraph_line_count
            line_heights.append(line_height)
            estimated_height += (
                before_spacing + first_line_height + max(paragraph_line_count - 1, 0) * line_height + after_spacing
            )
        if line_count == 0:
            continue
        available_height = max(element["height"] - element["paddingTop"] - element["paddingBottom"], 0)
        overflow = estimated_height - available_height
        if overflow <= 0:
            continue

        issues.append(
            {
                "level": "warning",
                "code": "text_may_overflow_shape",
                "elements": [element["id"]],
                "line_count": line_count,
                "line_height": max(line_heights),
                "estimated_height": estimated_height,
                "available_height": available_height,
                "overflow": overflow,
                "message": (
                    f'text shape {element["id"]} may overflow its own content box '
                    f'(estimated {estimated_height:g}px, available {available_height:g}px); '
                    'consider setting content wrap="true" autoFit="normal-auto-fit"'
                ),
                "hint": (
                    "Increase shape.height, reduce the text, or set content wrap=\"true\" "
                    "autoFit=\"normal-auto-fit\". "
                    "This is an estimate based on font size, line spacing, and wrapped line count."
                ),
            }
        )
    return issues
