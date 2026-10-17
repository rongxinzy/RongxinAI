# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Test suite for the xml-text-overlap lint script.

The cases live in the sibling package ``xml_text_overlap_lint_tests``, grouped
by responsibility (CLI, XML well-formedness, SXSD validation, canvas bounds,
table sizing, overlap detection). This module keeps the historical import path:
``XmlTextOverlapLintTest`` combines every case group into a single TestCase so
collectors (pytest, unittest) see exactly the same suite as before.
"""
from __future__ import annotations

# Kept importable for compatibility with the previous single-module layout.
import json  # noqa: F401
import subprocess  # noqa: F401
import sys  # noqa: F401
import tempfile  # noqa: F401
import unittest
from pathlib import Path  # noqa: F401

import xml_text_overlap_lint  # noqa: F401

from xml_text_overlap_lint_tests.canvas_cases import CanvasBoundsLintTestsMixin
from xml_text_overlap_lint_tests.cli_cases import CliLintTestsMixin
from xml_text_overlap_lint_tests.overlap_cases import OverlapLintTestsMixin
from xml_text_overlap_lint_tests.support import LintResultAssertionsMixin
from xml_text_overlap_lint_tests.sxsd_cases import SxsdLintTestsMixin
from xml_text_overlap_lint_tests.table_cases import TableLintTestsMixin
from xml_text_overlap_lint_tests.wellformed_cases import WellFormedXmlLintTestsMixin


class XmlTextOverlapLintTest(
    LintResultAssertionsMixin,
    CliLintTestsMixin,
    WellFormedXmlLintTestsMixin,
    SxsdLintTestsMixin,
    CanvasBoundsLintTestsMixin,
    TableLintTestsMixin,
    OverlapLintTestsMixin,
    unittest.TestCase,
):
    """All xml-text-overlap lint cases; the grouping lives in the parts package."""


if __name__ == "__main__":
    unittest.main()
