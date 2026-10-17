# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations


class XmlTextOverlapLintError(Exception):
    pass


def fail(message: str) -> None:
    raise XmlTextOverlapLintError(message)
