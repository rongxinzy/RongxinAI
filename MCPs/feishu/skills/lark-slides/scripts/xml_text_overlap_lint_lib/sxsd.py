# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import xml.etree.ElementTree as ET
from difflib import get_close_matches
from typing import Any

from .constants import (
    ROUNDTRIP_SXSD_ATTRS,
    SERVER_FILLED_SXSD_ATTRS,
    SVG_NS,
    SXSD_ATTR_ALIASES,
    SXSD_SCHEMA_PATH,
    SXSD_TAG_ALIASES,
    XS_NS,
    XML_NS,
)
from .xmlutils import iter_direct_xsd_children, strip_xsd_prefix, xml_local_name, xml_namespace

_SXSD_TAG_ATTRIBUTES_CACHE: dict[str, set[str]] | None = None


def load_sxsd_tag_attributes() -> dict[str, set[str]]:
    global _SXSD_TAG_ATTRIBUTES_CACHE
    if _SXSD_TAG_ATTRIBUTES_CACHE is not None:
        return _SXSD_TAG_ATTRIBUTES_CACHE

    schema_root = ET.parse(SXSD_SCHEMA_PATH).getroot()
    named_complex_types = {
        complex_type.attrib["name"]: complex_type
        for complex_type in schema_root.findall(f"{XS_NS}complexType")
        if complex_type.attrib.get("name")
    }
    resolving: set[str] = set()

    def attributes_for_complex_type(complex_type: ET.Element) -> set[str]:
        attrs: set[str] = {
            attribute.attrib["name"]
            for attribute in iter_direct_xsd_children(complex_type, "attribute")
            if attribute.attrib.get("name")
        }
        for content_name in ("simpleContent", "complexContent"):
            for complex_content in iter_direct_xsd_children(complex_type, content_name):
                for extension in iter_direct_xsd_children(complex_content, "extension"):
                    base_type = strip_xsd_prefix(extension.attrib.get("base"))
                    if base_type:
                        attrs.update(attributes_for_type(base_type))
                    attrs.update(
                        attribute.attrib["name"]
                        for attribute in iter_direct_xsd_children(extension, "attribute")
                        if attribute.attrib.get("name")
                    )
        return attrs

    def attributes_for_type(type_name: str) -> set[str]:
        if type_name in resolving:
            return set()
        complex_type = named_complex_types.get(type_name)
        if complex_type is None:
            return set()
        resolving.add(type_name)
        try:
            return attributes_for_complex_type(complex_type)
        finally:
            resolving.remove(type_name)

    tag_attributes: dict[str, set[str]] = {}
    for element in schema_root.iter(f"{XS_NS}element"):
        tag_name = element.attrib.get("name")
        if not tag_name:
            continue

        attrs: set[str] = set()
        type_name = strip_xsd_prefix(element.attrib.get("type"))
        if type_name:
            attrs.update(attributes_for_type(type_name))
        for complex_type in iter_direct_xsd_children(element, "complexType"):
            attrs.update(attributes_for_complex_type(complex_type))

        tag_attributes.setdefault(tag_name, set()).update(attrs)

    _SXSD_TAG_ATTRIBUTES_CACHE = tag_attributes
    return tag_attributes


def build_sxsd_tag_hint(tag_name: str, supported_tags: set[str]) -> str:
    alias = SXSD_TAG_ALIASES.get(tag_name)
    if alias:
        return f"Use {alias} instead of <{tag_name}>."
    if tag_name == "svg":
        return 'Inside <whiteboard>, write SVG as <svg xmlns="http://www.w3.org/2000/svg">...</svg>.'
    close_matches = get_close_matches(tag_name, sorted(supported_tags), n=3, cutoff=0.72)
    if close_matches:
        return "Unsupported SXSD tag. Did you mean " + ", ".join(f"<{match}>" for match in close_matches) + "?"
    return "Unsupported SXSD tag. Use only tags defined in slides_xml_schema_definition.xml."


def build_sxsd_attr_hint(tag_name: str, attr_name: str, allowed_attrs: set[str]) -> str:
    alias = SXSD_ATTR_ALIASES.get(attr_name)
    if alias and alias in allowed_attrs:
        return f'Use "{alias}" on <{tag_name}> instead of "{attr_name}".'
    close_matches = get_close_matches(attr_name, sorted(allowed_attrs), n=3, cutoff=0.68)
    if close_matches:
        return "Unsupported SXSD attribute. Did you mean " + ", ".join(f'"{match}"' for match in close_matches) + "?"
    allowed_summary = ", ".join(sorted(allowed_attrs)[:8])
    if len(allowed_attrs) > 8:
        allowed_summary += ", ..."
    return f"Unsupported SXSD attribute for <{tag_name}>. Allowed attributes include: {allowed_summary}."


def should_skip_sxsd_subtree(element: ET.Element, ancestors: list[str]) -> bool:
    return "whiteboard" in ancestors and xml_namespace(element.tag) == SVG_NS


def should_skip_sxsd_attribute(tag_name: str, attr_name: str) -> bool:
    return attr_name in SERVER_FILLED_SXSD_ATTRS or (tag_name, attr_name) in ROUNDTRIP_SXSD_ATTRS


def validate_sxsd_tag_attributes(root: ET.Element) -> list[dict[str, Any]]:
    tag_attributes = load_sxsd_tag_attributes()
    supported_tags = set(tag_attributes)
    issues: list[dict[str, Any]] = []

    def visit(element: ET.Element, ancestors: list[str], path: str) -> None:
        if should_skip_sxsd_subtree(element, ancestors):
            return

        tag_name = xml_local_name(element.tag)
        current_path = f"{path}/{tag_name}" if path else tag_name
        if tag_name not in supported_tags:
            issues.append(
                {
                    "level": "error",
                    "code": "sxsd_unsupported_tag",
                    "tag": tag_name,
                    "path": current_path,
                    "message": f"unsupported SXSD tag <{tag_name}> at {current_path}",
                    "hint": build_sxsd_tag_hint(tag_name, supported_tags),
                }
            )
            return
        else:
            allowed_attrs = tag_attributes[tag_name]
            for raw_attr_name in element.attrib:
                if raw_attr_name.startswith(XML_NS):
                    continue
                attr_name = xml_local_name(raw_attr_name)
                if should_skip_sxsd_attribute(tag_name, attr_name):
                    continue
                if attr_name in allowed_attrs:
                    continue
                issues.append(
                    {
                        "level": "error",
                        "code": "sxsd_unsupported_attr",
                        "tag": tag_name,
                        "attr": attr_name,
                        "path": current_path,
                        "message": f'unsupported SXSD attribute "{attr_name}" on <{tag_name}> at {current_path}',
                        "hint": build_sxsd_attr_hint(tag_name, attr_name, allowed_attrs),
                    }
                )

        for child in element:
            visit(child, [*ancestors, tag_name], current_path)

    visit(root, [], "")
    return issues
