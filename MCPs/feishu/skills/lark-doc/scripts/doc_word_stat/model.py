#!/usr/bin/env python3
# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Data model shared by the doc word stat parsers, counter and registry."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class TextRun:
    text: str
    attrs: dict[str, Any] = field(default_factory=dict)


@dataclass
class Block:
    type: str
    attrs: dict[str, Any] = field(default_factory=dict)
    children: list["Block"] = field(default_factory=list)
    text_runs: list[TextRun] = field(default_factory=list)
    raw: Any = None


@dataclass
class Segment:
    text: str
    block_type: str
    block_id: str | None = None
    kind: str = "text"
    boundary_before: bool = True
    boundary_after: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "block_type": self.block_type,
            "block_id": self.block_id,
            "kind": self.kind,
            "boundary_before": self.boundary_before,
            "boundary_after": self.boundary_after,
        }


@dataclass(frozen=True)
class UnknownBlock:
    type: str
    block_id: str | None = None
    action: str = "recurse_children"

    def to_dict(self) -> dict[str, str | None]:
        return {
            "type": self.type,
            "block_id": self.block_id,
            "action": self.action,
        }
