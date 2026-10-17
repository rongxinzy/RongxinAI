# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Shared assertion helpers for the xml-text-overlap lint test suite."""
from __future__ import annotations


class LintResultAssertionsMixin:
    """Assertions shared by all lint result checkers."""

    def assertNoXmlTextOverlapLintIssues(self, result: dict, sample_name: str) -> None:
        issue_summaries = []
        for slide in result.get("slides", []):
            for issue in slide.get("issues", []):
                issue_summaries.append(
                    f"slide {slide['slide_number']}: {issue['level']} {issue['code']} {issue['message']}"
                )
        if result.get("issues"):
            for issue in result["issues"]:
                issue_summaries.append(f"{issue['level']} {issue['code']} {issue['message']}")
        self.assertEqual(
            result["summary"]["error_count"],
            0,
            f"{sample_name} has XML text overlap lint errors:\n" + "\n".join(issue_summaries),
        )
        self.assertEqual(
            result["summary"]["warning_count"],
            0,
            f"{sample_name} has XML text overlap lint warnings:\n" + "\n".join(issue_summaries),
        )
