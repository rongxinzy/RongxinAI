# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import re
import xml.parsers.expat as expat
import xml.etree.ElementTree as ET
from typing import Any

from .attributes import extract_attribute
from .constants import SML_NAMESPACE, XS_NS
from .errors import fail


def xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if tag.startswith("{") else tag


def xml_namespace(tag: str) -> str | None:
    return tag.split("}", 1)[0] + "}" if tag.startswith("{") else None


def strip_xsd_prefix(value: str | None) -> str | None:
    if value is None:
        return None
    return value.rsplit(":", 1)[-1]


def iter_direct_xsd_children(element: ET.Element, local_name: str) -> list[ET.Element]:
    return [child for child in element if child.tag == f"{XS_NS}{local_name}"]


def extract_error_context(xml: str, line: int | None, column: int | None, radius: int = 40) -> str | None:
    if line is None or column is None:
        return None
    lines = xml.splitlines()
    if line < 1 or line > len(lines):
        return None
    source_line = lines[line - 1]
    start = max(column - radius, 0)
    end = min(column + radius, len(source_line))
    return source_line[start:end].strip()


def build_xml_error_issue(error: ET.ParseError, xml: str) -> dict[str, Any]:
    line, column = getattr(error, "position", (None, None))
    return {
        "level": "error",
        "code": "xml_not_well_formed",
        "message": f"XML is not well-formed: {error}",
        "line": line,
        "column": column,
        "context": extract_error_context(xml, line, column),
        "hint": (
            "Escape raw user text before placing it in XML. In text nodes and attribute values, bare & must be "
            "written as &amp;. In text nodes, write < as &lt; and > as &gt;. For attribute URLs, use a=1&amp;b=2."
        ),
    }


def validate_sml_tag_prefixes(xml: str) -> list[dict[str, Any]]:
    namespace_map: dict[str, str] = {}
    pending_declarations: list[tuple[str, str | None]] = []
    declarations_by_element: list[list[tuple[str, str | None]]] = []
    element_stack: list[str] = []
    issues: list[dict[str, Any]] = []

    parser = expat.ParserCreate(namespace_separator="|")
    parser.namespace_prefixes = True

    def handle_namespace_decl(prefix: str | None, namespace: str) -> None:
        normalized_prefix = prefix or ""
        previous_namespace = namespace_map.get(normalized_prefix)
        namespace_map[normalized_prefix] = namespace
        pending_declarations.append((normalized_prefix, previous_namespace))

    def handle_start_element(name: str, _attrs: dict[str, str]) -> None:
        declarations_by_element.append(pending_declarations.copy())
        pending_declarations.clear()
        name_parts = name.rsplit("|", 2)
        if len(name_parts) == 3:
            _namespace, local_name, prefix = name_parts
            element_name = f"{prefix}:{local_name}"
        else:
            prefix = ""
            local_name = name_parts[-1]
            element_name = local_name
        element_stack.append(element_name)
        if not prefix:
            return

        if namespace_map.get(prefix) != SML_NAMESPACE:
            return
        path = "/".join(element_stack)
        issues.append(
            {
                "level": "error",
                "code": "sml_prefixed_tag",
                "tag": element_name,
                "namespace": SML_NAMESPACE,
                "path": path,
                "line": parser.CurrentLineNumber,
                "column": parser.CurrentColumnNumber,
                "message": f"SML tag <{element_name}> must not use a namespace prefix at {path}",
                "hint": (
                    f'Use <{local_name}> under the default namespace '
                    f'<{local_name} xmlns="{SML_NAMESPACE}">, or use an unprefixed SML tag.'
                ),
            }
        )

    def handle_end_element(_name: str) -> None:
        for prefix, previous_namespace in reversed(declarations_by_element.pop()):
            if previous_namespace is None:
                namespace_map.pop(prefix, None)
            else:
                namespace_map[prefix] = previous_namespace
        element_stack.pop()

    parser.StartNamespaceDeclHandler = handle_namespace_decl
    parser.StartElementHandler = handle_start_element
    parser.EndElementHandler = handle_end_element
    parser.Parse(xml, True)
    return issues


def parse_xml_root(xml: str) -> tuple[ET.Element | None, dict[str, Any] | None]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as error:
        return None, build_xml_error_issue(error, xml)

    root_name = xml_local_name(root.tag)
    if root_name not in {"presentation", "slide"}:
        fail("input must contain a <presentation> or <slide> root")
    return root, None


def validate_xml_well_formed(xml: str) -> dict[str, Any] | None:
    _, xml_error = parse_xml_root(xml)
    return xml_error


def parse_presentation(xml: str) -> dict[str, Any]:
    presentation_match = re.search(r"<presentation\b([^>]*)>", xml)
    if presentation_match:
        return {
            "width": int(float(extract_attribute(presentation_match.group(1), "width") or 960)),
            "height": int(float(extract_attribute(presentation_match.group(1), "height") or 540)),
            "slides": re.findall(r"<slide\b[\s\S]*?</slide>", xml),
        }
    slide_match = re.findall(r"<slide\b[\s\S]*?</slide>", xml)
    if slide_match:
        return {"width": 960, "height": 540, "slides": slide_match}
    fail("input must contain a <presentation> or <slide> root")
