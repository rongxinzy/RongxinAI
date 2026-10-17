# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Command line entry point for the doc word stat tool."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

from .counting import Counter
from .extraction import ExtractContext, default_registry
from .markdown_parser import parse_markdown
from .xml_parser import UserInputError, parse_xml

VERSION = "0.1-alpha"


def build_diagnostics(items: list) -> dict[str, object]:
    actions: dict[str, int] = {}
    types: dict[str, int] = {}
    unsupported_types: dict[str, int] = {}
    unknown_types: dict[str, int] = {}
    for item in items:
        actions[item.action] = actions.get(item.action, 0) + 1
        types[item.type] = types.get(item.type, 0) + 1
        if item.action == "unsupported_resource":
            unsupported_types[item.type] = unsupported_types.get(item.type, 0) + 1
        if item.action == "recurse_children":
            unknown_types[item.type] = unknown_types.get(item.type, 0) + 1
    return {
        "actions": actions,
        "types": types,
        "unsupported_types": unsupported_types,
        "unknown_types": unknown_types,
        "has_unsupported": bool(unsupported_types),
        "has_unknown": bool(unknown_types),
    }


def read_input(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def read_resource_texts(path: str | None) -> dict[str, str]:
    if not path:
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("--resource-texts must be a JSON object")
    return {str(key): str(value) for key, value in payload.items()}


def extract_lark_json_content(source: str) -> str:
    try:
        envelope = json.loads(source)
    except json.JSONDecodeError as exc:
        raise UserInputError(f"could not parse lark-cli JSON envelope: {exc}") from exc

    if not isinstance(envelope, dict):
        raise UserInputError("lark-cli JSON envelope must be an object")
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise UserInputError("lark-cli JSON envelope is missing object field data")
    document = data.get("document")
    if not isinstance(document, dict):
        raise UserInputError("lark-cli JSON envelope is missing object field data.document")
    content = document.get("content")
    if not isinstance(content, str):
        raise UserInputError("lark-cli JSON envelope is missing string field data.document.content")
    return content


HELP_EPILOG = """
Examples:
  Local XML file:
    python3 doc_word_stat.py --protocol xml /absolute/path/doc.xml

  Local Markdown file:
    python3 doc_word_stat.py --protocol md /absolute/path/doc.md

  Pipe an extracted local file:
    cat /absolute/path/doc.xml | python3 doc_word_stat.py --protocol xml --pretty

  Lark CLI XML fetch, JSON envelope output:
    lark-cli docs +fetch --doc "$URL" --doc-format xml --detail full --format json \\
      | python3 doc_word_stat.py --protocol xml --lark-json --pretty

  Lark CLI Markdown fetch, raw content output:
    lark-cli docs +fetch --doc "$URL" --doc-format markdown \\
      | python3 doc_word_stat.py --protocol md

  Strict integration for agents or automation:
    lark-cli docs +fetch --doc "$URL" --doc-format xml --detail full --format json \\
      | python3 doc_word_stat.py --protocol xml --lark-json --fail-on-unsupported --fail-on-unknown
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Count semantic words and visible characters in Lark Docs XML or Markdown.",
        epilog=HELP_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {VERSION}",
    )
    parser.add_argument(
        "input",
        nargs="?",
        default="-",
        help="input file path, or '-' / omitted for stdin",
    )
    parser.add_argument(
        "--protocol",
        choices=("xml", "md"),
        required=True,
        help="input protocol produced by docs +fetch",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="pretty-print JSON output",
    )
    parser.add_argument(
        "--segments",
        action="store_true",
        help="include extracted text segments for debugging",
    )
    parser.add_argument(
        "--lark-json",
        action="store_true",
        help="read lark-cli docs +fetch JSON and count data.document.content",
    )
    parser.add_argument(
        "--resource-texts",
        help='optional JSON object mapping resource keys to visible text, e.g. {"task:<task-id>": "title"}',
    )
    parser.add_argument(
        "--fail-on-unsupported",
        action="store_true",
        help="exit with code 2 when unsupported_blocks is non-empty",
    )
    parser.add_argument(
        "--fail-on-unknown",
        action="store_true",
        help="exit with code 3 when unknown XML/Markdown block types are encountered",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = read_input(args.input)
    if args.lark_json:
        try:
            source = extract_lark_json_content(source)
        except UserInputError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1

    if args.protocol == "xml":
        try:
            blocks = parse_xml(source)
        except (ET.ParseError, UserInputError) as exc:
            print(f"error: could not parse XML input: {exc}", file=sys.stderr)
            return 1
    else:
        blocks = parse_markdown(source)

    ctx = ExtractContext(resource_texts=read_resource_texts(args.resource_texts))
    registry = default_registry()
    segments = []
    for block in blocks:
        segments.extend(registry.extract(block, ctx))

    stats = Counter().count_segments(segments)
    payload = stats.to_dict()
    payload["protocol"] = args.protocol
    payload["unknown_blocks"] = [item.to_dict() for item in ctx.unknown_blocks]
    payload["unsupported_blocks"] = [
        item.to_dict() for item in ctx.unknown_blocks if item.action == "unsupported_resource"
    ]
    payload["diagnostics"] = build_diagnostics(ctx.unknown_blocks)
    if args.segments:
        payload["segments"] = [segment.to_dict() for segment in segments]

    indent = 2 if args.pretty else None
    print(json.dumps(payload, ensure_ascii=False, indent=indent, sort_keys=args.pretty))
    if args.fail_on_unsupported and payload["unsupported_blocks"]:
        return 2
    if args.fail_on_unknown and payload["diagnostics"]["has_unknown"]:
        return 3
    return 0
