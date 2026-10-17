# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

from pathlib import Path


XS_NS = "{http://www.w3.org/2001/XMLSchema}"
XML_NS = "{http://www.w3.org/XML/1998/namespace}"
SVG_NS = "{http://www.w3.org/2000/svg}"
SML_NAMESPACE = "http://www.larkoffice.com/sml/2.0"
SXSD_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "references" / "slides_xml_schema_definition.xml"
ICONPARK_INDEX_PATH = Path(__file__).resolve().parents[2] / "references" / "iconpark-index.json"
SXSD_TAG_ALIASES = {
    "textbox": "<shape type=\"text\">",
    "textBox": "<shape type=\"text\">",
    "image": "<img>",
    "picture": "<img>",
}
SXSD_ATTR_ALIASES = {
    "x": "topLeftX",
    "left": "topLeftX",
    "y": "topLeftY",
    "top": "topLeftY",
    "w": "width",
    "h": "height",
    "fontColor": "color",
}
SERVER_FILLED_SXSD_ATTRS = {"id"}
ROUNDTRIP_SXSD_ATTRS = {
    ("chart", "updated"),
    ("chartData", "isStaticData"),
}
DEFAULT_TABLE_COLUMN_WIDTH = 110
DEFAULT_TABLE_ROW_HEIGHT = 37
