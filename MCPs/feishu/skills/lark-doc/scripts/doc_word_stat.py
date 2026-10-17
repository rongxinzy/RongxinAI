#!/usr/bin/env python3
# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Standalone Lark Docs word and character counter for XML or Markdown input.

The implementation lives in the sibling ``doc_word_stat`` package. This entry
script keeps the historical CLI path and re-exports every public name so
``import doc_word_stat`` (or loading this file directly) keeps working.
"""

from __future__ import annotations

# Back-compat: the original flat module exposed these stdlib names on its
# namespace; re-export them so the import surface is unchanged.
import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol
from xml.etree import ElementTree as ET

# The package is a sibling directory of this script; make it importable no
# matter how this file is invoked (script, runpy, or by file path).
_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from doc_word_stat.cli import (  # noqa: E402
    HELP_EPILOG,
    VERSION,
    build_diagnostics,
    extract_lark_json_content,
    main,
    parse_args,
    read_input,
    read_resource_texts,
)
from doc_word_stat.counting import (  # noqa: E402
    ASCII_COMPOUND_TOKEN_RE,
    CHINESE_PUNCTUATION,
    ENGLISH_PUNCTUATION,
    LexemeKind,
    URL_TOKEN_RE,
    Counter,
    Stats,
    is_ascii_letter,
    is_chinese_punctuation,
    is_digit,
    is_english_punctuation,
    is_han,
    is_unicode_symbol,
    utf16_units,
)
from doc_word_stat.extraction import (  # noqa: E402
    CheckboxHandler,
    ContainerHandler,
    ExtractContext,
    Handler,
    IgnoreHandler,
    ListHandler,
    Registry,
    SyncedSourceHandler,
    TaskHandler,
    TextBlockHandler,
    UnknownHandler,
    WhiteboardHandler,
    block_id,
    default_registry,
    raw_tag,
    runs_text,
)
from doc_word_stat.markdown_parser import (  # noqa: E402
    HEADING_RE,
    LIST_RE,
    QUOTE_RE,
    TABLE_SEP_RE,
    clean_inline,
    parse_markdown,
)
from doc_word_stat.model import Block, Segment, TextRun, UnknownBlock  # noqa: E402
from doc_word_stat.xml_parser import (  # noqa: E402
    FORBIDDEN_XML_DECL_RE,
    INLINE_TAGS,
    MAX_XML_INPUT_CHARS,
    SUBTYPE_ATTR_TAGS,
    TYPE_ALIASES,
    UserInputError,
    block_type_for,
    ensure_safe_xml_source,
    local_name,
    parse_xml,
)

__all__ = [
    "ASCII_COMPOUND_TOKEN_RE",
    "Block",
    "CHINESE_PUNCTUATION",
    "CheckboxHandler",
    "ContainerHandler",
    "Counter",
    "ENGLISH_PUNCTUATION",
    "ExtractContext",
    "FORBIDDEN_XML_DECL_RE",
    "HEADING_RE",
    "HELP_EPILOG",
    "Handler",
    "IgnoreHandler",
    "INLINE_TAGS",
    "LexemeKind",
    "ListHandler",
    "LIST_RE",
    "MAX_XML_INPUT_CHARS",
    "QUOTE_RE",
    "Registry",
    "Segment",
    "Stats",
    "SUBTYPE_ATTR_TAGS",
    "SyncedSourceHandler",
    "TABLE_SEP_RE",
    "TaskHandler",
    "TextBlockHandler",
    "TextRun",
    "TYPE_ALIASES",
    "URL_TOKEN_RE",
    "UnknownBlock",
    "UnknownHandler",
    "UserInputError",
    "VERSION",
    "WhiteboardHandler",
    "block_id",
    "block_type_for",
    "build_diagnostics",
    "clean_inline",
    "default_registry",
    "ensure_safe_xml_source",
    "extract_lark_json_content",
    "is_ascii_letter",
    "is_chinese_punctuation",
    "is_digit",
    "is_english_punctuation",
    "is_han",
    "is_unicode_symbol",
    "local_name",
    "main",
    "parse_args",
    "parse_markdown",
    "parse_xml",
    "raw_tag",
    "read_input",
    "read_resource_texts",
    "runs_text",
    "utf16_units",
]

if __name__ == "__main__":
    raise SystemExit(main())
