# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Markdown source parser producing :class:`Block` trees."""

from __future__ import annotations

import re

from .model import Block, TextRun

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*)$")
QUOTE_RE = re.compile(r"^\s*>\s?(.*)$")
TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")


def parse_markdown(source: str) -> list[Block]:
    lines = source.splitlines()
    blocks: list[Block] = []
    paragraph: list[str] = []
    i = 0

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append(Block(type="paragraph", text_runs=[TextRun(clean_inline(" ".join(paragraph)))]))
            paragraph.clear()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            i += 1
            continue

        if stripped.startswith("```") or stripped.startswith("~~~"):
            flush_paragraph()
            fence = stripped[:3]
            code_lines: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith(fence):
                code_lines.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1
            blocks.append(Block(type="code", text_runs=[TextRun("\n".join(code_lines))]))
            continue

        heading = HEADING_RE.match(line)
        if heading:
            flush_paragraph()
            blocks.append(Block(type="heading", text_runs=[TextRun(clean_inline(heading.group(2)))]))
            i += 1
            continue

        if _looks_like_table(lines, i):
            flush_paragraph()
            table, consumed = _parse_table(lines, i)
            blocks.append(table)
            i += consumed
            continue

        item = LIST_RE.match(line)
        if item:
            flush_paragraph()
            items: list[Block] = []
            while i < len(lines):
                match = LIST_RE.match(lines[i])
                if not match:
                    break
                items.append(Block(type="list_item", text_runs=[TextRun(clean_inline(match.group(1)))]))
                i += 1
            blocks.append(Block(type="list", children=items))
            continue

        quote = QUOTE_RE.match(line)
        if quote:
            flush_paragraph()
            quote_lines: list[str] = []
            while i < len(lines):
                match = QUOTE_RE.match(lines[i])
                if not match:
                    break
                quote_lines.append(match.group(1))
                i += 1
            blocks.append(Block(type="quote", text_runs=[TextRun(clean_inline(" ".join(quote_lines)))]))
            continue

        paragraph.append(stripped)
        i += 1

    flush_paragraph()
    return blocks


def clean_inline(text: str) -> str:
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"([*_`~]{1,3})(.*?)\1", r"\2", text)
    text = text.replace("\\", "")
    return text


def _looks_like_table(lines: list[str], i: int) -> bool:
    return i + 1 < len(lines) and "|" in lines[i] and TABLE_SEP_RE.match(lines[i + 1]) is not None


def _parse_table(lines: list[str], i: int) -> tuple[Block, int]:
    rows: list[Block] = []
    consumed = 0
    while i + consumed < len(lines):
        line = lines[i + consumed]
        stripped = line.strip()
        if not stripped or "|" not in stripped:
            break
        if consumed == 1 and TABLE_SEP_RE.match(stripped):
            consumed += 1
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        row = Block(
            type="tr",
            children=[
                Block(type="table_cell", text_runs=[TextRun(clean_inline(cell))])
                for cell in cells
                if cell
            ],
        )
        rows.append(row)
        consumed += 1
    return Block(type="table", children=rows), consumed
