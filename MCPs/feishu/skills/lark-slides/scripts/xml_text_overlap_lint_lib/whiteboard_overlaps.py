# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

from typing import Any

from .elements import is_text_element, is_whiteboard_element
from .geometry import contains, element_area, intersection_height, intersection_width, intersects


def is_bottom_layer_full_slide_whiteboard(
    whiteboard: dict[str, Any], other: dict[str, Any], slide_width: int | float, slide_height: int | float
) -> bool:
    return (
        whiteboard["order"] < other["order"]
        and whiteboard["x"] <= 2
        and whiteboard["y"] <= 2
        and whiteboard["width"] >= slide_width - 4
        and whiteboard["height"] >= slide_height - 4
    )


def is_background_container_for_whiteboard(container: dict[str, Any], whiteboard: dict[str, Any]) -> bool:
    if container["order"] > whiteboard["order"]:
        return False
    if is_text_element(container):
        return False
    return contains(container, whiteboard)


def build_whiteboard_external_overlap_issue(
    whiteboard: dict[str, Any], overlap_details: list[dict[str, Any]]
) -> dict[str, Any]:
    element_ids = [detail["element"] for detail in overlap_details]
    return {
        "level": "warning",
        "code": "whiteboard_external_overlap",
        "elements": [whiteboard["id"], *element_ids],
        "message": f'whiteboard {whiteboard["id"]} overlaps {len(element_ids)} sibling elements across its boundary',
        "hint": (
            "Treat this as a static whiteboard container-bbox risk, not final visual proof. "
            "After moving or accepting the overlap, use screenshot QA or equivalent rendered visual inspection as "
            "the final authority because XML readback does not include whiteboard SVG/Mermaid internals."
        ),
        "overlaps": overlap_details,
    }


def should_report_whiteboard_overlap(
    whiteboard: dict[str, Any],
    other: dict[str, Any],
    slide_width: int | float,
    slide_height: int | float,
) -> dict[str, Any] | None:
    if other is whiteboard or not intersects(whiteboard, other):
        return None
    if contains(whiteboard, other):
        return None
    if is_bottom_layer_full_slide_whiteboard(whiteboard, other, slide_width, slide_height):
        return None
    if is_background_container_for_whiteboard(other, whiteboard):
        return None

    overlap_width = intersection_width(whiteboard, other)
    overlap_height = intersection_height(whiteboard, other)
    if overlap_width < 8 or overlap_height < 8:
        return None

    other_area = element_area(other)
    if other_area <= 0:
        return None
    overlap_area = overlap_width * overlap_height
    overlap_ratio = overlap_area / other_area
    if overlap_ratio < 0.15:
        return None

    return {
        "element": other["id"],
        "kind": other["kind"],
        "type": other.get("type"),
        "overlap_width": overlap_width,
        "overlap_height": overlap_height,
        "target_overlap_ratio": round(overlap_ratio, 3),
    }


def prune_contained_text_overlap_details(
    overlap_details: list[dict[str, Any]], elements_by_id: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    pruned: list[dict[str, Any]] = []
    for detail in overlap_details:
        element = elements_by_id[detail["element"]]
        if is_text_element(element):
            has_reported_container = any(
                detail["element"] != other_detail["element"]
                and not is_text_element(elements_by_id[other_detail["element"]])
                and contains(elements_by_id[other_detail["element"]], element)
                for other_detail in overlap_details
            )
            if has_reported_container:
                continue
        pruned.append(detail)
    return pruned


def detect_whiteboard_external_overlaps(
    elements: list[dict[str, Any]], slide_width: int | float, slide_height: int | float
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    elements_by_id = {element["id"]: element for element in elements}
    for whiteboard in [element for element in elements if is_whiteboard_element(element)]:
        overlap_details = [
            detail
            for element in elements
            if (
                detail := should_report_whiteboard_overlap(
                    whiteboard,
                    element,
                    slide_width,
                    slide_height,
                )
            )
            is not None
        ]
        overlap_details = prune_contained_text_overlap_details(overlap_details, elements_by_id)
        if overlap_details:
            issues.append(build_whiteboard_external_overlap_issue(whiteboard, overlap_details))
    return issues
