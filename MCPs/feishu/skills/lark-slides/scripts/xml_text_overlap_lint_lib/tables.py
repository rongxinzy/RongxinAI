# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import math
import re
from typing import Any

from .attributes import extract_numeric_attribute
from .layout import is_filled_size, solve_weighted_min_layout


def extract_table_column_sizes(table_xml: str) -> list[int | float | None]:
    sizes: list[int | float | None] = []
    for match in re.finditer(r"<col\b([^>]*)/?>", table_xml):
        attrs = match.group(1)
        span = extract_numeric_attribute(attrs, "span") or 1
        span_count = int(span) if math.isfinite(span) and span > 0 and float(span).is_integer() else 1
        sizes.extend([extract_numeric_attribute(attrs, "width")] * span_count)
    return sizes


def extract_table_row_sizes(table_xml: str) -> list[int | float | None]:
    return [extract_numeric_attribute(match.group(1), "height") for match in re.finditer(r"<tr\b([^>]*)>", table_xml)]


def resolve_table_dimension(
    table_xml: str,
    declared_size: int | float | None,
    extract_sizes: Any,
    default_size: int | float,
) -> tuple[int | float | None, dict[str, Any] | None]:
    input_sizes = extract_sizes(table_xml)
    if not input_sizes:
        return declared_size, None
    layout = solve_weighted_min_layout(
        input_sizes, default_size, declared_size if is_filled_size(declared_size) else None
    )
    return layout["actual_size"], layout


def format_size(size: int | float) -> str:
    return f"{size:g}"


def detect_table_layout_size_mismatches(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    dimensions = {
        "width": ("col", "column widths"),
        "height": ("tr", "row heights"),
    }
    for table in (element for element in elements if element["kind"] == "table"):
        for dimension, (child_tag, child_description) in dimensions.items():
            target_size = table[f"declared_{dimension}"]
            if not is_filled_size(target_size):
                continue
            layout = table["table_layouts"][dimension]
            if layout is None:
                continue
            actual_size = layout["actual_size"]
            if math.isclose(actual_size, target_size, rel_tol=1e-9, abs_tol=1e-9):
                continue
            issues.append(
                {
                    "level": "info",
                    "code": "table_resolved_size_mismatch",
                    "elements": [table["id"]],
                    "dimension": dimension,
                    "declared_size": target_size,
                    "resolved_size": actual_size,
                    "resolved_sizes": layout["final_sizes"],
                    "message": (
                        f'table {table["id"]} declares {dimension}={format_size(target_size)}px, but its '
                        f"{child_description} resolve to {format_size(actual_size)}px"
                    ),
                    "hint": (
                        f"Set table.{dimension} to {format_size(actual_size)}px, or adjust <{child_tag}> sizes "
                        f"so their resolved total matches {format_size(target_size)}px."
                    ),
                }
            )
    return issues
