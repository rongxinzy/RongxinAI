# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from difflib import get_close_matches
from typing import Any

from .constants import ICONPARK_INDEX_PATH
from .errors import fail
from .xmlutils import xml_local_name

_ICONPARK_ICON_TYPES_CACHE: set[str] | None = None


def load_iconpark_icon_types() -> set[str]:
    global _ICONPARK_ICON_TYPES_CACHE
    if _ICONPARK_ICON_TYPES_CACHE is not None:
        return _ICONPARK_ICON_TYPES_CACHE

    try:
        index_data = json.loads(ICONPARK_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"invalid iconpark index JSON: {error}")
    icons = index_data.get("icons")
    if not isinstance(icons, list):
        fail("iconpark index must contain an icons array")

    icon_types = {
        icon["iconType"]
        for icon in icons
        if isinstance(icon, dict) and isinstance(icon.get("iconType"), str) and icon["iconType"]
    }
    _ICONPARK_ICON_TYPES_CACHE = icon_types
    return icon_types


def build_iconpark_icon_type_hint(icon_type: str, supported_icon_types: set[str]) -> str:
    close_matches = get_close_matches(icon_type, sorted(supported_icon_types), n=3, cutoff=0.58)
    if close_matches:
        return (
            "iconType must exist in iconpark-index.json. Did you mean "
            + ", ".join(f'"{match}"' for match in close_matches)
            + "?"
        )
    return "iconType must exist in iconpark-index.json. Use scripts/iconpark_tool.py to search supported icons."


def validate_iconpark_icon_types(root: ET.Element) -> list[dict[str, Any]]:
    supported_icon_types: set[str] | None = None
    issues: list[dict[str, Any]] = []

    def direct_child(element: ET.Element, local_name: str) -> ET.Element | None:
        return next((child for child in element if xml_local_name(child.tag) == local_name), None)

    def is_transparent_color(color: str) -> bool:
        normalized = re.sub(r"\s+", "", color).lower()
        if normalized == "transparent":
            return True
        rgba_match = re.fullmatch(r"rgba\([^,]+,[^,]+,[^,]+,([0-9.]+)\)", normalized)
        if not rgba_match:
            return False
        try:
            return float(rgba_match.group(1)) <= 0
        except ValueError:
            return False

    def append_missing_fill_color_issue(current_path: str) -> None:
        issues.append(
            {
                "level": "error",
                "code": "icon_missing_fill_color",
                "tag": "icon",
                "path": current_path,
                "message": f"<icon> must set explicit non-transparent fillColor for visual visibility at {current_path}",
                "hint": 'Add <fill><fillColor color="rgba(R, G, B, 1)"/></fill> inside <icon>. This is a visual lint rule, not an SXSD required field.',
            }
        )

    def visit(element: ET.Element, path: str) -> None:
        nonlocal supported_icon_types
        tag_name = xml_local_name(element.tag)
        current_path = f"{path}/{tag_name}" if path else tag_name
        if tag_name == "icon":
            icon_type = element.attrib.get("iconType")
            if icon_type is not None:
                if supported_icon_types is None:
                    supported_icon_types = load_iconpark_icon_types()
                if icon_type not in supported_icon_types:
                    issues.append(
                        {
                            "level": "error",
                            "code": "iconpark_unsupported_icon_type",
                            "tag": "icon",
                            "attr": "iconType",
                            "iconType": icon_type,
                            "path": current_path,
                            "message": f'unsupported iconpark iconType "{icon_type}" at {current_path}',
                            "hint": build_iconpark_icon_type_hint(icon_type, supported_icon_types),
                        }
                    )
            fill = direct_child(element, "fill")
            fill_color = direct_child(fill, "fillColor") if fill is not None else None
            color = fill_color.attrib.get("color") if fill_color is not None else None
            if not color:
                append_missing_fill_color_issue(current_path)
            elif is_transparent_color(color):
                issues.append(
                    {
                        "level": "error",
                        "code": "icon_transparent_fill_color",
                        "tag": "icon",
                        "attr": "fillColor",
                        "path": current_path,
                        "color": color,
                        "message": f'<icon> fillColor must not be transparent for visual visibility at {current_path}: "{color}"',
                        "hint": 'Use an opaque visible color, for example <fillColor color="rgba(37, 99, 235, 1)"/>.',
                    }
                )
        for child in element:
            visit(child, current_path)

    visit(root, "")
    return issues
