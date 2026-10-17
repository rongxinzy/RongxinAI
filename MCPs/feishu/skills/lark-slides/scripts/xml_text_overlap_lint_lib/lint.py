# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

from typing import Any

from .canvas import detect_elements_out_of_canvas
from .elements import extract_elements
from .geometry import intersects
from .iconpark import validate_iconpark_icon_types
from .sxsd import validate_sxsd_tag_attributes
from .tables import detect_table_layout_size_mismatches
from .text_overlaps import (
    detect_image_text_occlusions,
    detect_text_may_overflow_shapes,
    should_flag_horizontal_text_overflow,
    should_flag_overlap,
)
from .whiteboard_overlaps import detect_whiteboard_external_overlaps
from .xmlutils import parse_presentation, parse_xml_root, validate_sml_tag_prefixes


def lint_slide(
    slide_xml: str, slide_number: int, slide_width: int | float = 960, slide_height: int | float = 540
) -> dict[str, Any]:
    elements = extract_elements(slide_xml)
    issues: list[dict[str, Any]] = [
        *detect_whiteboard_external_overlaps(elements, slide_width, slide_height),
        *detect_elements_out_of_canvas(elements, slide_width, slide_height),
        *detect_table_layout_size_mismatches(elements),
        *detect_text_may_overflow_shapes(elements),
        *detect_image_text_occlusions(elements),
    ]

    for index, left in enumerate(elements):
        for right in elements[index + 1 :]:
            horizontal_overflow = should_flag_horizontal_text_overflow(left, right)
            if not horizontal_overflow and (not intersects(left, right) or not should_flag_overlap(left, right)):
                continue
            issues.append(
                {
                    "level": "error",
                    "code": "bbox_overlap",
                    "elements": [left["id"], right["id"]],
                    "message": f'{left["id"]} overlaps {right["id"]}',
                }
            )

    return {"slide_number": slide_number, "element_count": len(elements), "issues": issues}


def lint_xml(xml: str, source_path: str | None = None) -> dict[str, Any]:
    root, xml_error = parse_xml_root(xml)
    if xml_error:
        return {
            "file": source_path,
            "slide_size": {"width": 960, "height": 540},
            "summary": {"slide_count": 0, "error_count": 1, "warning_count": 0, "info_count": 0},
            "issues": [xml_error],
            "slides": [],
        }

    namespace_issues = validate_sml_tag_prefixes(xml)
    sxsd_issues = validate_sxsd_tag_attributes(root) if root is not None else []
    iconpark_issues = validate_iconpark_icon_types(root) if root is not None else []
    top_level_issues = [*namespace_issues, *sxsd_issues, *iconpark_issues]
    if namespace_issues:
        error_count = sum(1 for issue in top_level_issues if issue["level"] == "error")
        warning_count = sum(1 for issue in top_level_issues if issue["level"] == "warning")
        info_count = sum(1 for issue in top_level_issues if issue["level"] == "info")
        return {
            "file": source_path,
            "slide_size": {"width": 960, "height": 540},
            "summary": {
                "slide_count": 0,
                "error_count": error_count,
                "warning_count": warning_count,
                "info_count": info_count,
            },
            "issues": top_level_issues,
            "slides": [],
        }
    presentation = parse_presentation(xml)
    slides = [
        lint_slide(slide_xml, index + 1, presentation["width"], presentation["height"])
        for index, slide_xml in enumerate(presentation["slides"])
    ]
    error_count = sum(1 for issue in top_level_issues if issue["level"] == "error")
    error_count += sum(1 for slide in slides for issue in slide["issues"] if issue["level"] == "error")
    warning_count = sum(1 for issue in top_level_issues if issue["level"] == "warning")
    warning_count += sum(1 for slide in slides for issue in slide["issues"] if issue["level"] == "warning")
    info_count = sum(1 for issue in top_level_issues if issue["level"] == "info")
    info_count += sum(1 for slide in slides for issue in slide["issues"] if issue["level"] == "info")
    result = {
        "file": source_path,
        "slide_size": {"width": presentation["width"], "height": presentation["height"]},
        "summary": {
            "slide_count": len(slides),
            "error_count": error_count,
            "warning_count": warning_count,
            "info_count": info_count,
        },
        "slides": slides,
    }
    if top_level_issues:
        result["issues"] = top_level_issues
    return result
