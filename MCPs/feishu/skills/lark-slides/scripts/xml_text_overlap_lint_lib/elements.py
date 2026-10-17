# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import re
from typing import Any

from .attributes import extract_attribute, extract_numeric_attribute, extract_tag_attributes
from .constants import DEFAULT_TABLE_COLUMN_WIDTH, DEFAULT_TABLE_ROW_HEIGHT
from .tables import extract_table_column_sizes, extract_table_row_sizes, resolve_table_dimension
from .text import extract_text_paragraphs, strip_xml_paragraphs


def extract_elements(slide_xml: str) -> list[dict[str, Any]]:
    elements: list[dict[str, Any]] = []

    for match in re.finditer(r"<(shape|img|table|chart|whiteboard)\b([^>]*)>", slide_xml):
        kind, attrs = match.group(1), match.group(2)
        content = ""
        if kind in {"shape", "table"}:
            close_index = slide_xml.find(f"</{kind}>", match.end())
            if close_index != -1:
                content = slide_xml[match.end() : close_index]

        element_id = extract_attribute(attrs, "id") or f"{kind}-{len(elements) + 1}"
        x = extract_numeric_attribute(attrs, "topLeftX")
        y = extract_numeric_attribute(attrs, "topLeftY")
        width = extract_numeric_attribute(attrs, "width")
        height = extract_numeric_attribute(attrs, "height")
        rotation = extract_numeric_attribute(attrs, "rotation") or 0
        alpha = extract_numeric_attribute(attrs, "alpha")
        table_layouts: dict[str, dict[str, Any] | None] = {}
        if kind == "table":
            width, table_layouts["width"] = resolve_table_dimension(
                content, width, extract_table_column_sizes, DEFAULT_TABLE_COLUMN_WIDTH
            )
            height, table_layouts["height"] = resolve_table_dimension(
                content, height, extract_table_row_sizes, DEFAULT_TABLE_ROW_HEIGHT
            )
        if all(value is not None for value in [x, y, width, height]):
            element = {
                "id": element_id,
                "kind": kind,
                "type": extract_attribute(attrs, "type") or kind,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "alpha": alpha if alpha is not None else 1,
                "order": len(elements),
            }
            if kind == "table":
                element.update(
                    {
                        "declared_width": extract_numeric_attribute(attrs, "width"),
                        "declared_height": extract_numeric_attribute(attrs, "height"),
                        "table_layouts": table_layouts,
                    }
                )
            if kind == "shape":
                content_attrs = extract_tag_attributes(content, "content")
                font_size = extract_numeric_attribute(content_attrs, "fontSize")
                if font_size is None:
                    font_size = extract_numeric_attribute(attrs, "fontSize")
                element.update(
                    {
                        "textType": extract_attribute(content_attrs, "textType"),
                        "textAlign": extract_attribute(content_attrs, "textAlign"),
                        "verticalAlign": extract_attribute(content_attrs, "verticalAlign") or "middle",
                        "vert": extract_attribute(attrs, "vert") or "horz",
                        "autoFit": extract_attribute(content_attrs, "autoFit"),
                        "wrap": extract_attribute(content_attrs, "wrap"),
                        "lineSpacing": extract_attribute(content_attrs, "lineSpacing"),
                        "beforeLineSpacing": extract_attribute(content_attrs, "beforeLineSpacing"),
                        "afterLineSpacing": extract_attribute(content_attrs, "afterLineSpacing"),
                        "paddingTop": extract_numeric_attribute(content_attrs, "paddingTop") or 0,
                        "paddingRight": extract_numeric_attribute(content_attrs, "paddingRight") or 0,
                        "paddingBottom": extract_numeric_attribute(content_attrs, "paddingBottom") or 0,
                        "paddingLeft": extract_numeric_attribute(content_attrs, "paddingLeft") or 0,
                        "fontSize": font_size if font_size is not None else 16,
                        "text": strip_xml_paragraphs(content),
                        "paragraphs": extract_text_paragraphs(content, font_size if font_size is not None else 16),
                    }
                )
            elements.append(element)
    return elements


def is_text_element(element: dict[str, Any]) -> bool:
    return element["kind"] == "shape" and element["type"] == "text"


def is_whiteboard_element(element: dict[str, Any]) -> bool:
    return element["kind"] == "whiteboard"


def has_text_content(element: dict[str, Any]) -> bool:
    return bool(element.get("text"))


def is_vertical_text(element: dict[str, Any]) -> bool:
    return element.get("vert") in {"vert", "vert270", "word-art-vert", "word-art-vert-rtl", "ea-vert"}
