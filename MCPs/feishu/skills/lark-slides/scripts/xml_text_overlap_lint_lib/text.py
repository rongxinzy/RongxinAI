# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import re
import unicodedata
from typing import Any

from .attributes import extract_attribute, extract_numeric_attribute


def strip_xml(value: str, preserve_line_breaks: bool = False) -> str:
    stripped = re.sub(r"<!\[CDATA\[([\s\S]*?)\]\]>", r"\1", value)
    if preserve_line_breaks:
        stripped = re.sub(r"<br\b[^>]*>", "\n", stripped)
    stripped = re.sub(r"<[^>]+>", " ", stripped)
    stripped = stripped.replace("&nbsp;", " ")
    stripped = stripped.replace("&amp;", "&")
    stripped = stripped.replace("&lt;", "<")
    stripped = stripped.replace("&gt;", ">")
    stripped = stripped.replace("&quot;", '"')
    stripped = stripped.replace("&#39;", "'")
    if preserve_line_breaks:
        return "\n".join(re.sub(r"\s+", " ", line).strip() for line in stripped.split("\n"))
    return re.sub(r"\s+", " ", stripped).strip()


def strip_xml_paragraphs(value: str) -> str:
    paragraphs = re.findall(r"<p\b[^>]*>([\s\S]*?)</p\s*>", value)
    if paragraphs:
        return "\n".join(strip_xml(paragraph, preserve_line_breaks=True) for paragraph in paragraphs)
    return strip_xml(value, preserve_line_breaks=True)


def extract_text_paragraphs(value: str, default_font_size: int | float) -> list[dict[str, Any]]:
    paragraphs = []
    for attrs, body in re.findall(r"<p\b([^>]*)>([\s\S]*?)</p\s*>", value):
        paragraphs.append(
            {
                "text": strip_xml(body, preserve_line_breaks=True),
                "fontSize": extract_max_span_font_size(body, default_font_size),
                "textAlign": extract_attribute(attrs, "textAlign"),
                "lineSpacing": extract_attribute(attrs, "lineSpacing"),
                "beforeLineSpacing": extract_attribute(attrs, "beforeLineSpacing"),
                "afterLineSpacing": extract_attribute(attrs, "afterLineSpacing"),
            }
        )
    return paragraphs


def extract_max_span_font_size(value: str, default_font_size: int | float) -> int | float:
    font_sizes = [
        font_size
        for attrs in re.findall(r"<span\b([^>]*)>", value)
        if (font_size := extract_numeric_attribute(attrs, "fontSize")) is not None
    ]
    return max([default_font_size, *font_sizes])


def normalize_text_for_overlap(text: str) -> str:
    return re.sub(r"\s+", "", text)


def estimate_character_width(character: str, font_size: int | float) -> int | float:
    if character.isspace():
        return font_size * 0.33
    if unicodedata.east_asian_width(character) in {"F", "W"}:
        return font_size
    return font_size * 0.55


def estimate_text_width(text: str, font_size: int | float) -> int | float:
    return sum(estimate_character_width(character, font_size) for character in text)
