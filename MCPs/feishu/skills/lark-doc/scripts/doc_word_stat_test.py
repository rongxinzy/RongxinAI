# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Behavior tests for doc_word_stat (data model, counting, parsers, CLI)."""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import doc_word_stat
from doc_word_stat import (
    Counter,
    ExtractContext,
    Segment,
    Stats,
    UserInputError,
    build_diagnostics,
    clean_inline,
    default_registry,
    extract_lark_json_content,
    is_chinese_punctuation,
    is_han,
    parse_markdown,
    parse_xml,
    read_resource_texts,
    utf16_units,
)

SCRIPT_PATH = Path(__file__).resolve().parent / "doc_word_stat.py"


def segment(text: str, kind: str = "text", block_type: str = "paragraph") -> Segment:
    return Segment(text=text, block_type=block_type, kind=kind)


def count_text(*texts: str) -> Stats:
    return Counter().count_segments([segment(text) for text in texts])


class CharacterClassifierTest(unittest.TestCase):
    def test_is_han_ranges(self) -> None:
        for ch in ("一", "漢", "𠀀", "㐀"):
            self.assertTrue(is_han(ch), ch)
        for ch in ("a", "1", "，", "★"):
            self.assertFalse(is_han(ch), ch)

    def test_is_chinese_punctuation(self) -> None:
        for ch in ("，", "。", "！", "￥"):
            self.assertTrue(is_chinese_punctuation(ch), ch)
        for ch in (",", ".", "a", "一"):
            self.assertFalse(is_chinese_punctuation(ch), ch)

    def test_utf16_units(self) -> None:
        self.assertEqual(utf16_units("a"), 1)
        self.assertEqual(utf16_units("一"), 1)
        self.assertEqual(utf16_units("🙂"), 2)


class CounterTest(unittest.TestCase):
    def test_han_chars_each_count_as_word(self) -> None:
        stats = count_text("你好世界")
        self.assertEqual(stats.han_chars, 4)
        self.assertEqual(stats.word_count, 4)
        self.assertEqual(stats.char_count, 4)

    def test_english_words(self) -> None:
        stats = count_text("hello world foo")
        self.assertEqual(stats.english_words, 3)
        self.assertEqual(stats.word_count, 3)
        self.assertEqual(stats.english_letters, 13)
        self.assertEqual(stats.char_count, 13)

    def test_numeric_lexemes_stay_single_words(self) -> None:
        stats = count_text("3.14 1,000 2026-06-30 v1.2.3")
        self.assertEqual(stats.number_words, 3)
        self.assertEqual(stats.english_words, 1)  # v1.2.3 counts as english
        self.assertEqual(stats.word_count, 4)
        self.assertEqual(stats.digits, 18)
        self.assertEqual(stats.english_punctuations, 6)

    def test_url_counts_as_single_word(self) -> None:
        stats = count_text("see https://example.com/a/b?v=1 now")
        self.assertEqual(stats.word_count, 3)
        self.assertEqual(stats.english_words, 3)
        self.assertEqual(stats.char_count, 33)

    def test_ascii_compound_token(self) -> None:
        stats = count_text("path/to/file.txt and a_b-c")
        self.assertEqual(stats.word_count, 3)
        self.assertEqual(stats.english_words, 3)
        self.assertEqual(stats.char_count, 24)

    def test_mixed_punctuation(self) -> None:
        stats = count_text("你好，world. 逗号，句号。")
        self.assertEqual(stats.han_chars, 6)
        self.assertEqual(stats.chinese_punctuations, 3)
        self.assertEqual(stats.english_punctuations, 1)
        self.assertEqual(stats.word_count, 10)

    def test_unicode_symbols_each_count_as_word(self) -> None:
        stats = count_text("a ★ b ➜ c")
        self.assertEqual(stats.symbol_words, 2)
        self.assertEqual(stats.word_count, 5)
        self.assertEqual(stats.char_count, 5)

    def test_han_separated_by_ascii_slash(self) -> None:
        stats = count_text("甲/乙 丙")
        self.assertEqual(stats.han_chars, 3)
        self.assertEqual(stats.english_punctuations, 1)
        self.assertEqual(stats.symbol_words, 1)
        self.assertEqual(stats.word_count, 4)

    def test_apostrophe_and_hyphen_join_english_runs(self) -> None:
        stats = count_text("don't state-of-the-art")
        self.assertEqual(stats.english_words, 2)
        self.assertEqual(stats.word_count, 2)
        self.assertEqual(stats.char_count, 21)

    def test_emoji_counts_two_utf16_units(self) -> None:
        stats = count_text("🙂🙂 x")
        self.assertEqual(stats.symbol_words, 2)
        self.assertEqual(stats.symbol_chars, 4)
        self.assertEqual(stats.char_count, 5)
        self.assertEqual(stats.word_count, 3)

    def test_marker_segment_counts_one_word_per_char(self) -> None:
        stats = Counter().count_segments(
            [Segment(text="3.", block_type="list_marker", kind="text"), segment("第三项")]
        )
        self.assertEqual(stats.number_words, 1)
        self.assertEqual(stats.han_chars, 3)
        self.assertEqual(stats.word_count, 4)

    def test_code_segment_lexemes(self) -> None:
        stats = Counter().count_segments(
            [Segment(text="let x = 3.14; // 注释", block_type="code", kind="code")]
        )
        self.assertEqual(stats.english_words, 2)
        self.assertEqual(stats.digits, 3)
        self.assertEqual(stats.han_chars, 2)
        self.assertEqual(stats.word_count, 6)

    def test_stats_to_dict_shape(self) -> None:
        payload = count_text("一 a").to_dict()
        self.assertEqual(
            payload,
            {
                "word_count": 2,
                "char_count": 2,
                "breakdown": {
                    "han_chars": 1,
                    "english_words": 1,
                    "number_words": 0,
                    "chinese_punctuations": 0,
                    "english_letters": 1,
                    "digits": 0,
                    "english_punctuations": 0,
                    "symbol_words": 0,
                    "symbol_chars": 0,
                },
            },
        )

    def test_segments_with_boundaries_split_lexemes(self) -> None:
        stats = Counter().count_segments(
            [Segment(text="ab", block_type="p"), Segment(text="cd", block_type="p")]
        )
        self.assertEqual(stats.english_words, 2)


class MarkdownParserTest(unittest.TestCase):
    def test_parse_markdown_block_structure(self) -> None:
        source = "\n".join(
            [
                "# 标题 T",
                "",
                "para one **bold** [link](http://x.y)",
                "",
                "- a 一",
                "- b 二",
                "",
                "| A | B |",
                "| --- | --- |",
                "| 甲 | data |",
                "",
                "```py",
                "x=1",
                "```",
                "> quote 行",
            ]
        )
        blocks = parse_markdown(source)
        self.assertEqual(
            [(block.type, len(block.children)) for block in blocks],
            [
                ("heading", 0),
                ("paragraph", 0),
                ("list", 2),
                ("table", 2),
                ("code", 0),
                ("quote", 0),
            ],
        )
        self.assertEqual(blocks[2].children[0].text_runs[0].text, "a 一")
        code = blocks[4].text_runs[0].text
        self.assertEqual(code, "x=1")
        quote = blocks[5].text_runs[0].text
        self.assertEqual(quote, "quote 行")

    def test_clean_inline_strips_markup(self) -> None:
        self.assertEqual(
            clean_inline("**bold** *it* `code` ~~del~~ [t](u) ![alt](i)"),
            "bold it code del t alt",
        )

    def test_empty_source_yields_no_blocks(self) -> None:
        self.assertEqual(parse_markdown(""), [])


class XmlParserTest(unittest.TestCase):
    def test_type_aliases_and_inline_tags(self) -> None:
        blocks = parse_xml(
            "<doc><title>周报</title><p>a<b>bold</b>c</p><pre>x=1</pre></doc>"
        )
        self.assertEqual([block.type for block in blocks[0].children], ["title", "paragraph", "code"])
        paragraph = blocks[0].children[1]
        self.assertEqual("".join(run.text for run in paragraph.text_runs), "aboldc")

    def test_adjacent_top_level_blocks_are_wrapped(self) -> None:
        blocks = parse_xml("<p>一</p><p>二</p>")
        self.assertEqual(blocks[0].type, "fragment")
        self.assertEqual(len(blocks[0].children), 2)

    def test_image_uses_caption_fallback(self) -> None:
        blocks = parse_xml('<doc><img caption="图片说明"/></doc>')
        image = blocks[0].children[0]
        self.assertEqual(image.type, "image")
        self.assertEqual(image.text_runs[0].text, "图片说明")

    def test_doctype_and_entity_are_rejected(self) -> None:
        with self.assertRaises(UserInputError):
            parse_xml('<!DOCTYPE doc [<!ENTITY x "y">]><doc/>')

    def test_oversized_input_is_rejected(self) -> None:
        with self.assertRaises(UserInputError):
            parse_xml("<doc>" + "a" * (doc_word_stat.MAX_XML_INPUT_CHARS + 1) + "</doc>")

    def test_empty_source_yields_no_blocks(self) -> None:
        self.assertEqual(parse_xml("   "), [])


class ExtractionTest(unittest.TestCase):
    def extract(self, xml: str, resource_texts: dict[str, str] | None = None):
        registry = default_registry()
        ctx = ExtractContext(resource_texts=resource_texts or {})
        segments = []
        for block in parse_xml(xml):
            segments.extend(registry.extract(block, ctx))
        return segments, ctx

    def test_list_markers(self) -> None:
        segments, ctx = self.extract(
            '<doc><ul><li seq="3">三</li><li>四</li></ul></doc>'
        )
        self.assertEqual(
            [(s.text, s.block_type, s.kind) for s in segments],
            [
                ("•", "list_marker", "marker"),
                ("三", "list_item", "list_item"),
                ("•", "list_marker", "marker"),
                ("四", "list_item", "list_item"),
            ],
        )
        self.assertEqual(ctx.unknown_blocks, [])

    def test_ordered_list_uses_seq_attribute_then_increments(self) -> None:
        segments, _ = self.extract('<doc><ol><li seq="3">三</li><li>四</li></ol></doc>')
        markers = [s.text for s in segments if s.block_type == "list_marker"]
        self.assertEqual(markers, ["3.", "4."])

    def test_checkbox_marker(self) -> None:
        segments, _ = self.extract(
            '<doc><checkbox done="true">已完成</checkbox><checkbox>未完成</checkbox></doc>'
        )
        markers = [s.text for s in segments if s.block_type == "checkbox_marker"]
        self.assertEqual(markers, ["☑", "☐"])

    def test_task_uses_resource_texts(self) -> None:
        segments, ctx = self.extract(
            '<doc><task task-id="t1" status="done"/></doc>',
            resource_texts={"task:t1": "任务 Title"},
        )
        self.assertEqual(
            [(s.text, s.block_type, s.kind) for s in segments],
            [("☑", "task_marker", "marker"), ("任务 Title", "task", "resource_title")],
        )
        self.assertEqual(ctx.unknown_blocks, [])

    def test_task_without_resource_is_ignored(self) -> None:
        segments, ctx = self.extract('<doc><task task-id="t1"/></doc>')
        self.assertEqual(segments, [])
        self.assertEqual(ctx.unknown_blocks[0].action, "ignored_resource")

    def test_whiteboard_actions(self) -> None:
        _, ctx = self.extract(
            '<doc><whiteboard type="blank"/><whiteboard type="smart"/><whiteboard/></doc>'
        )
        actions = [item.action for item in ctx.unknown_blocks]
        self.assertEqual(actions, ["ignored_resource", "unsupported_resource", "ignored_resource"])

    def test_unknown_block_recurse_and_diagnostics(self) -> None:
        segments, ctx = self.extract(
            '<doc><okr id="o1">目标</okr><weird>未知</weird></doc>'
        )
        # okr is ignored as unsupported; unknown tags recurse into children.
        self.assertEqual([(s.text, s.block_type) for s in segments], [("未知", "weird")])
        diagnostics = build_diagnostics(ctx.unknown_blocks)
        self.assertEqual(diagnostics["unsupported_types"], {"okr": 1})
        self.assertEqual(diagnostics["unknown_types"], {"weird": 1})
        self.assertTrue(diagnostics["has_unsupported"])
        self.assertTrue(diagnostics["has_unknown"])


class CliHelpersTest(unittest.TestCase):
    def test_extract_lark_json_content(self) -> None:
        source = json.dumps({"data": {"document": {"content": "<doc><p>一</p></doc>"}}})
        self.assertEqual(extract_lark_json_content(source), "<doc><p>一</p></doc>")

    def test_extract_lark_json_content_errors(self) -> None:
        with self.assertRaises(UserInputError):
            extract_lark_json_content("not json")
        with self.assertRaises(UserInputError):
            extract_lark_json_content("[]")
        with self.assertRaises(UserInputError):
            extract_lark_json_content('{"data": 1}')
        with self.assertRaises(UserInputError):
            extract_lark_json_content('{"data": {"document": 1}}')
        with self.assertRaises(UserInputError):
            extract_lark_json_content('{"data": {"document": {"content": 1}}}')

    def test_read_resource_texts(self) -> None:
        self.assertEqual(read_resource_texts(None), {})
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            handle.write(json.dumps({"task:t1": "标题"}))
            path = handle.name
        try:
            self.assertEqual(read_resource_texts(path), {"task:t1": "标题"})
        finally:
            Path(path).unlink()
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            handle.write("[]")
            path = handle.name
        try:
            with self.assertRaises(ValueError):
                read_resource_texts(path)
        finally:
            Path(path).unlink()


class MainTest(unittest.TestCase):
    def run_main(self, argv: list[str], stdin: str) -> tuple[int, str]:
        buffer = io.StringIO()
        argv = argv + ["-"]
        with mock.patch.object(sys, "argv", ["doc_word_stat.py", *argv]):
            with mock.patch.object(sys, "stdin", io.StringIO(stdin)):
                with redirect_stdout(buffer):
                    code = doc_word_stat.main()
        return code, buffer.getvalue()

    def test_main_xml_stdin(self) -> None:
        code, out = self.run_main(["--protocol", "xml"], "<doc><p>一 one</p></doc>")
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["protocol"], "xml")
        self.assertEqual(payload["word_count"], 2)
        self.assertEqual(payload["unknown_blocks"], [])

    def test_main_lark_json_envelope(self) -> None:
        envelope = json.dumps({"data": {"document": {"content": "<doc><p>二 two</p></doc>"}}})
        code, out = self.run_main(["--protocol", "xml", "--lark-json"], envelope)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["word_count"], 2)

    def test_main_lark_json_error_exits_1(self) -> None:
        code, _ = self.run_main(["--protocol", "xml", "--lark-json"], "not json")
        self.assertEqual(code, 1)

    def test_main_xml_parse_error_exits_1(self) -> None:
        code, _ = self.run_main(["--protocol", "xml"], "not <valid")
        self.assertEqual(code, 1)

    def test_main_fail_on_unsupported_and_unknown(self) -> None:
        xml = '<doc><okr>目标</okr><weird>未知</weird></doc>'
        code, _ = self.run_main(["--protocol", "xml", "--fail-on-unsupported"], xml)
        self.assertEqual(code, 2)
        code, _ = self.run_main(["--protocol", "xml", "--fail-on-unknown"], xml)
        self.assertEqual(code, 3)

    def test_main_markdown(self) -> None:
        code, out = self.run_main(["--protocol", "md"], "# 标题\n\n正文 one")
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["protocol"], "md")
        self.assertEqual(payload["word_count"], 5)


class ScriptEntryTest(unittest.TestCase):
    def test_script_runs_from_any_directory(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--protocol", "xml"],
            input="<doc><p>你好 world</p></doc>",
            capture_output=True,
            text=True,
            cwd=tempfile.gettempdir(),
            check=True,
        )
        payload = json.loads(result.stdout)
        self.assertEqual(payload["word_count"], 3)
        self.assertEqual(payload["protocol"], "xml")

    def test_version_flag(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--version"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(result.stdout.strip(), f"doc_word_stat.py {doc_word_stat.VERSION}")


if __name__ == "__main__":
    unittest.main()
