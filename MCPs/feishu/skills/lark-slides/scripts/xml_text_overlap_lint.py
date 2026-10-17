#!/usr/bin/env python3
# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Slides XML text-overlap linter.

Public facade: every helper lives in the sibling ``xml_text_overlap_lint_lib``
package and is re-exported here so ``import xml_text_overlap_lint`` keeps
working for existing callers (tests and CLI usage in SKILL.md).
"""

from __future__ import annotations

import sys

from xml_text_overlap_lint_lib.attributes import (
    extract_attribute,
    extract_numeric_attribute,
    extract_tag_attributes,
)
from xml_text_overlap_lint_lib.canvas import detect_elements_out_of_canvas, element_canvas_bbox
from xml_text_overlap_lint_lib.cli import parse_args, print_usage, read_file, run_cli
from xml_text_overlap_lint_lib.constants import (
    DEFAULT_TABLE_COLUMN_WIDTH,
    DEFAULT_TABLE_ROW_HEIGHT,
    ICONPARK_INDEX_PATH,
    ROUNDTRIP_SXSD_ATTRS,
    SERVER_FILLED_SXSD_ATTRS,
    SML_NAMESPACE,
    SVG_NS,
    SXSD_ATTR_ALIASES,
    SXSD_SCHEMA_PATH,
    SXSD_TAG_ALIASES,
    XML_NS,
    XS_NS,
)
from xml_text_overlap_lint_lib.elements import (
    extract_elements,
    has_text_content,
    is_text_element,
    is_vertical_text,
    is_whiteboard_element,
)
from xml_text_overlap_lint_lib.errors import XmlTextOverlapLintError, fail
from xml_text_overlap_lint_lib.geometry import (
    contains,
    element_area,
    intersection_area,
    intersection_height,
    intersection_width,
    intersects,
)
from xml_text_overlap_lint_lib.iconpark import (
    build_iconpark_icon_type_hint,
    load_iconpark_icon_types,
    validate_iconpark_icon_types,
)
from xml_text_overlap_lint_lib.layout import (
    fill_last_size_gap,
    is_filled_size,
    solve_weighted_min_layout,
    sum_sizes,
)
from xml_text_overlap_lint_lib.lint import lint_slide, lint_xml
from xml_text_overlap_lint_lib.sxsd import (
    build_sxsd_attr_hint,
    build_sxsd_tag_hint,
    load_sxsd_tag_attributes,
    should_skip_sxsd_attribute,
    should_skip_sxsd_subtree,
    validate_sxsd_tag_attributes,
)
from xml_text_overlap_lint_lib.tables import (
    detect_table_layout_size_mismatches,
    extract_table_column_sizes,
    extract_table_row_sizes,
    format_size,
    resolve_table_dimension,
)
from xml_text_overlap_lint_lib.text import (
    estimate_character_width,
    estimate_text_width,
    extract_max_span_font_size,
    extract_text_paragraphs,
    normalize_text_for_overlap,
    strip_xml,
    strip_xml_paragraphs,
)
from xml_text_overlap_lint_lib.text_metrics import (
    estimate_text_line_count,
    estimate_text_line_count_for_text,
    estimate_text_line_height,
    estimate_text_max_line_width,
    estimate_text_visual_bbox,
    is_decorative_text,
    is_similar_text_overlay,
)
from xml_text_overlap_lint_lib.text_overlaps import (
    detect_image_text_occlusions,
    detect_text_may_overflow_shapes,
    is_template_text_stack,
    should_flag_horizontal_text_overflow,
    should_flag_overlap,
)
from xml_text_overlap_lint_lib.whiteboard_overlaps import (
    build_whiteboard_external_overlap_issue,
    detect_whiteboard_external_overlaps,
    is_background_container_for_whiteboard,
    is_bottom_layer_full_slide_whiteboard,
    prune_contained_text_overlap_details,
    should_report_whiteboard_overlap,
)
from xml_text_overlap_lint_lib.xmlutils import (
    build_xml_error_issue,
    extract_error_context,
    iter_direct_xsd_children,
    parse_presentation,
    parse_xml_root,
    strip_xsd_prefix,
    validate_sml_tag_prefixes,
    validate_xml_well_formed,
    xml_local_name,
    xml_namespace,
)

if __name__ == "__main__":
    try:
        run_cli()
    except XmlTextOverlapLintError as error:
        print(f"xml-text-overlap-lint error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
