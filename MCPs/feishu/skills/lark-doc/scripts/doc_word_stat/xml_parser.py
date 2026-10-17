# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Lark Docs XML source parser producing :class:`Block` trees."""

from __future__ import annotations

import re
from xml.etree import ElementTree as ET

from .model import Block, TextRun

INLINE_TAGS = {
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "del",
    "span",
    "text",
    "plain_text",
    "code",
    "a",
    "link",
    "mention",
    "mention-doc",
    "mention-user",
}

TYPE_ALIASES = {
    "doc": "document",
    "document": "document",
    "fragment": "fragment",
    "p": "paragraph",
    "paragraph": "paragraph",
    "heading": "heading",
    "h1": "heading",
    "h2": "heading",
    "h3": "heading",
    "h4": "heading",
    "h5": "heading",
    "h6": "heading",
    "h7": "heading",
    "h8": "heading",
    "h9": "heading",
    "ul": "list",
    "ol": "list",
    "li": "list_item",
    "task": "task",
    "todo": "list_item",
    "blockquote": "quote",
    "quote": "quote",
    "br": "br",
    "hr": "hr",
    "title": "title",
    "checkbox": "checkbox",
    "grid": "grid",
    "column": "column",
    "table": "table",
    "colgroup": "colgroup",
    "col": "col",
    "tr": "tr",
    "td": "table_cell",
    "th": "table_cell",
    "pre": "code",
    "code_block": "code",
    "callout": "callout",
    "figure": "figure",
    "toggle": "toggle",
    "img": "image",
    "source": "source",
    "file": "file",
    "media": "media",
    "latex": "latex",
    "cite": "cite",
    "bookmark": "bookmark",
    "button": "button",
    "whiteboard": "whiteboard",
    "mermaid": "mermaid",
    "plantuml": "plantuml",
    "poll": "poll",
    "isv": "isv",
    "mindnote": "mindnote",
    "diagram": "diagram",
    "sheet": "sheet",
    "bitable": "bitable",
    "base-ref": "base_ref",
    "base_ref": "base_ref",
    "base-refer": "base_ref",
    "base_refer": "base_ref",
    "synced-reference": "synced_reference",
    "synced_reference": "synced_reference",
    "synced-source": "synced_source",
    "synced_source": "synced_source",
    "okr": "okr",
    "chat-card": "chat_card",
    "chat_card": "chat_card",
    "sub_page_list": "sub-page-list",
    "sub-page-list": "sub-page-list",
}

SUBTYPE_ATTR_TAGS = {
    "a",
    "button",
    "cite",
    "img",
    "sheet",
    "source",
    "whiteboard",
    "base-ref",
    "base_ref",
    "base-refer",
    "base_refer",
    "synced-reference",
    "synced_reference",
    "synced-source",
    "synced_source",
    "okr",
    "chat-card",
    "chat_card",
    "sub_page_list",
    "sub-page-list",
}

MAX_XML_INPUT_CHARS = 20_000_000
FORBIDDEN_XML_DECL_RE = re.compile(r"<!\s*(?:DOCTYPE|ENTITY)\b", re.IGNORECASE)


class UserInputError(ValueError):
    pass


def local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


def block_type_for(elem: ET.Element) -> str:
    tag = local_name(elem.tag)
    explicit = elem.attrib.get("block_type")
    if explicit is None and tag not in SUBTYPE_ATTR_TAGS:
        explicit = elem.attrib.get("type")
    if explicit:
        return TYPE_ALIASES.get(explicit, explicit)
    return TYPE_ALIASES.get(tag, tag)


def ensure_safe_xml_source(source: str) -> None:
    if len(source) > MAX_XML_INPUT_CHARS:
        raise UserInputError(
            f"XML input is too large ({len(source)} chars, limit {MAX_XML_INPUT_CHARS})"
        )
    if FORBIDDEN_XML_DECL_RE.search(source):
        raise UserInputError("XML input must not contain DOCTYPE or ENTITY declarations")


def parse_xml(source: str) -> list[Block]:
    source = source.strip()
    if not source:
        return []
    ensure_safe_xml_source(source)
    try:
        root = ET.fromstring(source)
    except ET.ParseError:
        # docs +fetch raw output can occasionally include adjacent top-level
        # blocks. Wrap them so standard ElementTree can parse the stream.
        root = ET.fromstring(f"<fragment>{source}</fragment>")
    return [_parse_block(root)]


def _parse_block(elem: ET.Element) -> Block:
    block = Block(type=block_type_for(elem), attrs=dict(elem.attrib), raw=elem)
    _collect_content(elem, block)
    if not block.text_runs and not block.children:
        if block.type == "image":
            display = elem.attrib.get("caption")
        else:
            display = (
                elem.attrib.get("text")
                or elem.attrib.get("name")
                or elem.attrib.get("title")
                or elem.attrib.get("alt")
                or elem.attrib.get("caption")
            )
        if display:
            block.text_runs.append(TextRun(display, dict(elem.attrib)))
    return block


def _collect_content(elem: ET.Element, block: Block) -> None:
    if elem.text:
        block.text_runs.append(TextRun(elem.text))

    for child in list(elem):
        tag = local_name(child.tag)
        if tag == "br":
            block.text_runs.append(TextRun("\n"))
        elif tag in INLINE_TAGS:
            _collect_inline(child, block)
        else:
            block.children.append(_parse_block(child))
        if child.tail:
            block.text_runs.append(TextRun(child.tail))


def _collect_inline(elem: ET.Element, block: Block) -> None:
    if local_name(elem.tag) == "br":
        block.text_runs.append(TextRun("\n", dict(elem.attrib)))
        return

    display = (
        elem.attrib.get("text")
        or elem.attrib.get("name")
        or elem.attrib.get("title")
        or elem.attrib.get("alt")
    )
    if display:
        block.text_runs.append(TextRun(display, dict(elem.attrib)))
        return

    if elem.text:
        block.text_runs.append(TextRun(elem.text, dict(elem.attrib)))
    for child in list(elem):
        _collect_inline(child, block)
        if child.tail:
            block.text_runs.append(TextRun(child.tail))
