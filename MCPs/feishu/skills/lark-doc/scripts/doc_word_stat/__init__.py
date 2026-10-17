# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Standalone Lark Docs word and character counter for XML or Markdown input.

The public API of this package matches the historical flat ``doc_word_stat.py``
module so every name stays importable from ``doc_word_stat``.
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

from .cli import (
    HELP_EPILOG,
    VERSION,
    build_diagnostics,
    extract_lark_json_content,
    main,
    parse_args,
    read_input,
    read_resource_texts,
)
from .counting import (
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
from .extraction import (
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
from .markdown_parser import (
    HEADING_RE,
    LIST_RE,
    QUOTE_RE,
    TABLE_SEP_RE,
    clean_inline,
    parse_markdown,
)
from .model import Block, Segment, TextRun, UnknownBlock
from .xml_parser import (
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
