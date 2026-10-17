# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import re


def extract_attribute(tag_source: str, name: str) -> str | None:
    match = re.search(fr'{re.escape(name)}="([^"]+)"', tag_source)
    return match.group(1) if match else None


def extract_numeric_attribute(tag_source: str, name: str) -> int | float | None:
    raw = extract_attribute(tag_source, name)
    if raw is None:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return int(value) if value.is_integer() else value


def extract_tag_attributes(value: str, tag: str) -> str:
    match = re.search(fr"<{re.escape(tag)}\b([^>]*)>", value)
    return match.group(1) if match else ""
