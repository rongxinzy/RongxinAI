# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Block-to-segment extraction registry with per-block-type handlers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from .model import Block, Segment, UnknownBlock


@dataclass
class ExtractContext:
    unknown_blocks: list[UnknownBlock] = field(default_factory=list)
    resource_texts: dict[str, str] = field(default_factory=dict)


class Handler(Protocol):
    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        raise NotImplementedError


def block_id(block: Block) -> str | None:
    for key in ("id", "block_id", "block-id", "token"):
        value = block.attrs.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def runs_text(block: Block) -> str:
    return "".join(run.text for run in block.text_runs)


def raw_tag(block: Block) -> str:
    tag = getattr(getattr(block, "raw", None), "tag", "") or ""
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


class TextBlockHandler:
    def __init__(self, kind: str = "text") -> None:
        self.kind = kind

    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        segments: list[Segment] = []
        text = runs_text(block)
        if text.strip():
            segments.append(
                Segment(
                    text=text,
                    block_type=block.type,
                    block_id=block_id(block),
                    kind=self.kind,
                )
            )
        for child in block.children:
            segments.extend(registry.extract(child, ctx))
        return segments


class ContainerHandler:
    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        segments: list[Segment] = []
        text = runs_text(block)
        if text.strip():
            segments.append(
                Segment(text=text, block_type=block.type, block_id=block_id(block), kind="text")
            )
        for child in block.children:
            segments.extend(registry.extract(child, ctx))
        return segments


class ListHandler:
    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        tag = raw_tag(block)
        if tag not in {"ol", "ul"}:
            return ContainerHandler().extract(block, registry, ctx)

        segments: list[Segment] = []
        text = runs_text(block)
        if text.strip():
            segments.append(
                Segment(text=text, block_type=block.type, block_id=block_id(block), kind="text")
            )

        next_seq = 1
        for child in block.children:
            if child.type == "list_item":
                if tag == "ol":
                    seq = child.attrs.get("seq")
                    if isinstance(seq, str) and seq.isdigit():
                        marker = seq
                        next_seq = int(seq) + 1
                    else:
                        marker = str(next_seq)
                        next_seq += 1
                    segments.append(
                        Segment(
                            text=f"{marker}.",
                            block_type="list_marker",
                            block_id=block_id(child),
                            kind="text",
                        )
                    )
                else:
                    segments.append(
                        Segment(
                            text="•",
                            block_type="list_marker",
                            block_id=block_id(child),
                            kind="marker",
                        )
                    )
            segments.extend(registry.extract(child, ctx))
        return segments


class CheckboxHandler(TextBlockHandler):
    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        return [
            Segment(
                text="☑" if block.attrs.get("done") == "true" else "☐",
                block_type="checkbox_marker",
                block_id=block_id(block),
                kind="marker",
            ),
            *super().extract(block, registry, ctx),
        ]


class UnknownHandler:
    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        ctx.unknown_blocks.append(UnknownBlock(type=block.type, block_id=block_id(block)))
        return ContainerHandler().extract(block, registry, ctx)


class IgnoreHandler:
    def __init__(self, action: str = "ignored") -> None:
        self.action = action

    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        ctx.unknown_blocks.append(UnknownBlock(type=block.type, block_id=block_id(block), action=self.action))
        return []


class TaskHandler:
    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        task_id = block.attrs.get("task-id") or block.attrs.get("task_id")
        if isinstance(task_id, str) and task_id:
            text = ctx.resource_texts.get(f"task:{task_id}")
            if text and text.strip():
                marker = "☑" if block.attrs.get("status") in {"done", "completed", "complete"} else "☐"
                return [
                    Segment(text=marker, block_type="task_marker", block_id=block_id(block), kind="marker"),
                    Segment(text=text, block_type="task", block_id=block_id(block), kind="resource_title"),
                ]

        ctx.unknown_blocks.append(UnknownBlock(type=block.type, block_id=block_id(block), action="ignored_resource"))
        return []


class WhiteboardHandler:
    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        board_type = block.attrs.get("type")
        is_empty_resource_shell = not board_type and not block.children and not runs_text(block).strip()
        action = (
            "ignored_resource"
            if board_type in {"blank", "mermaid", "plantuml", "svg"} or is_empty_resource_shell
            else "unsupported_resource"
        )
        ctx.unknown_blocks.append(UnknownBlock(type=block.type, block_id=block_id(block), action=action))
        return []


class SyncedSourceHandler:
    def extract(self, block: Block, registry: "Registry", ctx: ExtractContext) -> list[Segment]:
        if block.children:
            segments: list[Segment] = []
            for child in block.children:
                segments.extend(registry.extract(child, ctx))
            return segments

        ctx.unknown_blocks.append(UnknownBlock(type=block.type, block_id=block_id(block), action="unsupported_resource"))
        return []


class Registry:
    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}
        self._unknown = UnknownHandler()

    def register(self, *types: str, handler: Handler) -> None:
        for typ in types:
            self._handlers[typ] = handler

    def extract(self, block: Block, ctx: ExtractContext) -> list[Segment]:
        handler = self._handlers.get(block.type, self._unknown)
        return handler.extract(block, self, ctx)


def default_registry() -> Registry:
    registry = Registry()
    registry.register("document", "fragment", "root", handler=ContainerHandler())
    registry.register("title", handler=TextBlockHandler("title"))
    registry.register("paragraph", "p", handler=TextBlockHandler("text"))
    registry.register(
        "heading",
        "h",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "h7",
        "h8",
        "h9",
        handler=TextBlockHandler("heading"),
    )
    registry.register("list", "ul", "ol", handler=ListHandler())
    registry.register("list_item", "li", "todo", handler=TextBlockHandler("list_item"))
    registry.register("checkbox", handler=CheckboxHandler("list_item"))
    registry.register(
        "quote",
        "blockquote",
        "callout",
        "toggle",
        "grid",
        "column",
        "figure",
        handler=ContainerHandler(),
    )
    registry.register("table", "thead", "tbody", "tr", handler=ContainerHandler())
    registry.register("table_cell", "td", "th", handler=TextBlockHandler("table_cell"))
    registry.register("code", "code_block", "pre", handler=TextBlockHandler("code"))
    registry.register("link", "a", "mention", "mention-doc", "mention-user", "time", handler=TextBlockHandler("inline"))
    registry.register("image", "img", handler=TextBlockHandler("caption"))
    registry.register("colgroup", "col", "br", "hr", handler=IgnoreHandler("ignored_structure"))
    registry.register("button", "cite", "latex", "bookmark", handler=IgnoreHandler("ignored_inline"))
    registry.register("task", handler=TaskHandler())
    registry.register("whiteboard", handler=WhiteboardHandler())
    registry.register("synced_source", handler=SyncedSourceHandler())
    registry.register(
        "mermaid",
        "sheet",
        "source",
        "file",
        "media",
        "chat_card",
        "base_ref",
        "bitable",
        "synced_reference",
        "poll",
        "isv",
        "mindnote",
        "diagram",
        "sub-page-list",
        handler=IgnoreHandler("ignored_resource"),
    )
    registry.register(
        "okr",
        "plantuml",
        handler=IgnoreHandler("unsupported_resource"),
    )
    return registry
