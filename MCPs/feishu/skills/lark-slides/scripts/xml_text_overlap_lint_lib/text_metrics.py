# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import math
import re
from difflib import SequenceMatcher
from typing import Any

from .elements import has_text_content, is_text_element
from .text import estimate_text_width, normalize_text_for_overlap


def is_decorative_text(element: dict[str, Any]) -> bool:
    text = element.get("text") or ""
    return bool(text) and re.search(r"[A-Za-z0-9\u4e00-\u9fff]", text) is None


def estimate_text_max_line_width(element: dict[str, Any]) -> int | float:
    font_size = element["fontSize"] if isinstance(element["fontSize"], (int, float)) else 16
    paragraphs = [paragraph for paragraph in re.split(r"\n+", element["text"]) if paragraph]
    return max([estimate_text_width(paragraph, font_size) for paragraph in paragraphs] or [1])


def is_similar_text_overlay(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_text = normalize_text_for_overlap(left.get("text") or "")
    right_text = normalize_text_for_overlap(right.get("text") or "")
    if not left_text or not right_text:
        return False
    if left_text == right_text or left_text in right_text or right_text in left_text:
        return True
    return SequenceMatcher(None, left_text, right_text).ratio() >= 0.75


def estimate_text_line_count_for_text(element: dict[str, Any], text: str) -> int:
    font_size = element["fontSize"] if isinstance(element["fontSize"], (int, float)) else 16
    hard_lines = text.split("\n")
    if not text:
        return 0
    line_count = 0
    for hard_line in hard_lines:
        if element.get("wrap") in {"false", "0"}:
            line_count += 1
            continue
        logical_width = max(estimate_text_width(hard_line, font_size), 1)
        line_count += max(1, math.ceil(logical_width / max(element["width"], 1)))
    return line_count


def estimate_text_line_count(element: dict[str, Any]) -> int:
    return max(estimate_text_line_count_for_text(element, element["text"]), 1)


def estimate_text_line_height(element: dict[str, Any], line_spacing: str | None = None) -> int | float | None:
    font_size = element["fontSize"] if isinstance(element["fontSize"], (int, float)) else 16
    line_spacing = line_spacing or "multiple:1.5"
    match = re.fullmatch(r"(multiple|fixed):([0-9]+(?:\.[0-9]+)?)", line_spacing)
    if match is None:
        return None
    spacing_type, value = match.groups()
    return font_size * float(value) if spacing_type == "multiple" else float(value)


def estimate_text_visual_bbox(element: dict[str, Any]) -> dict[str, int | float] | None:
    if not is_text_element(element) or not has_text_content(element) or is_decorative_text(element):
        return None

    padding_left = element.get("paddingLeft", 0)
    padding_right = element.get("paddingRight", 0)
    padding_top = element.get("paddingTop", 0)
    padding_bottom = element.get("paddingBottom", 0)
    content_width = max(element["width"] - padding_left - padding_right, 0)
    content_height = max(element["height"] - padding_top - padding_bottom, 0)
    font_size = element["fontSize"] if isinstance(element["fontSize"], (int, float)) else 16
    line_count = estimate_text_line_count(element)
    estimated_width = max(1, estimate_text_max_line_width(element))
    visual_width = estimated_width if element.get("wrap") in {"false", "0"} else min(content_width, estimated_width)
    visual_height = min(content_height, max(1, line_count * font_size * 1.2))
    x = element["x"] + padding_left
    if element.get("textAlign") == "center":
        x += (content_width - visual_width) / 2
    elif element.get("textAlign") == "right":
        x += content_width - visual_width
    y = element["y"] + padding_top
    if element.get("verticalAlign") == "middle":
        y += (content_height - visual_height) / 2
    elif element.get("verticalAlign") == "bottom":
        y += content_height - visual_height
    return {
        "x": x,
        "y": y,
        "width": visual_width,
        "height": visual_height,
    }
