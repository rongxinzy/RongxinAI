# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT
"""Word and character counting rules plus the streaming :class:`Counter`."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from .model import Segment

CHINESE_PUNCTUATION = set("，。！？；：、（）《》〈〉“”‘’【】「」『』〔〕…—～·￥")
ENGLISH_PUNCTUATION = set(
    r"""!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~"""
)


LexemeKind = Literal["english", "number"]
URL_TOKEN_RE = re.compile(r"https?://[!-~]+")
ASCII_COMPOUND_TOKEN_RE = re.compile(
    r"[A-Za-z0-9]+(?:[._/@:-][A-Za-z0-9]+)+"
)


@dataclass
class Stats:
    word_count: int = 0
    char_count: int = 0
    han_chars: int = 0
    english_words: int = 0
    number_words: int = 0
    chinese_punctuations: int = 0
    english_letters: int = 0
    digits: int = 0
    english_punctuations: int = 0
    symbol_words: int = 0
    symbol_chars: int = 0

    def to_dict(self) -> dict[str, object]:
        return {
            "word_count": self.word_count,
            "char_count": self.char_count,
            "breakdown": {
                "han_chars": self.han_chars,
                "english_words": self.english_words,
                "number_words": self.number_words,
                "chinese_punctuations": self.chinese_punctuations,
                "english_letters": self.english_letters,
                "digits": self.digits,
                "english_punctuations": self.english_punctuations,
                "symbol_words": self.symbol_words,
                "symbol_chars": self.symbol_chars,
            },
        }


def is_han(ch: str) -> bool:
    code = ord(ch)
    return (
        0x3400 <= code <= 0x4DBF
        or 0x4E00 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0x20000 <= code <= 0x2A6DF
        or 0x2A700 <= code <= 0x2B73F
        or 0x2B740 <= code <= 0x2B81F
        or 0x2B820 <= code <= 0x2CEAF
        or 0x30000 <= code <= 0x3134F
    )


def is_ascii_letter(ch: str) -> bool:
    return ("a" <= ch <= "z") or ("A" <= ch <= "Z")


def is_digit(ch: str) -> bool:
    return "0" <= ch <= "9"


def is_chinese_punctuation(ch: str) -> bool:
    if ch in CHINESE_PUNCTUATION:
        return True
    return unicodedata.category(ch).startswith("P") and unicodedata.east_asian_width(ch) in {
        "W",
        "F",
    }


def is_english_punctuation(ch: str) -> bool:
    return ch in ENGLISH_PUNCTUATION


def is_unicode_symbol(ch: str) -> bool:
    return unicodedata.category(ch).startswith("S")


def utf16_units(ch: str) -> int:
    return len(ch.encode("utf-16-le")) // 2


class Counter:
    def __init__(self) -> None:
        self.stats = Stats()
        self._lexeme_kind: LexemeKind | None = None
        self._lexeme_has_digit = False
        self._symbol_run_length = 0
        self._at_boundary = True

    def count_segments(self, segments: list[Segment]) -> Stats:
        for segment in segments:
            if segment.boundary_before:
                self._end_unit()
                self._at_boundary = True
            if segment.kind == "marker":
                self.write_marker(segment.text)
            elif segment.kind == "code":
                self.write_code(segment.text)
            else:
                self.write(segment.text)
            if segment.boundary_after:
                self._end_unit()
                self._at_boundary = True
        self._end_unit()
        return self.stats

    def write(self, text: str) -> None:
        i = 0
        while i < len(text):
            consumed = self._write_ascii_compound_token(text, i)
            if consumed:
                i += consumed
                continue
            if self._write_visible_ascii_separator(text, i):
                i += 1
                continue
            self._write_char(text[i])
            i += 1

    def write_marker(self, text: str) -> None:
        for ch in text:
            if ch.isspace():
                continue
            self._end_unit()
            self.stats.word_count += 1
            self.stats.char_count += 1
            self._at_boundary = False

    def write_code(self, text: str) -> None:
        for ch in text:
            self._write_code_char(ch)

    def _write_code_char(self, ch: str) -> None:
        if ch.isspace():
            self._end_unit()
            self._at_boundary = True
            return

        if is_han(ch):
            self._end_lexeme()
            self._end_symbol_run(count_word=False)
            self.stats.han_chars += 1
            self.stats.word_count += 1
            self.stats.char_count += 1
            self._at_boundary = False
            return

        if is_ascii_letter(ch):
            self._end_symbol_run(count_word=False)
            self.stats.english_letters += 1
            self.stats.char_count += 1
            if self._lexeme_kind is None:
                self._lexeme_kind = "english"
            elif self._lexeme_kind == "number":
                self._lexeme_kind = "english"
            self._at_boundary = False
            return

        if is_digit(ch):
            self._end_symbol_run(count_word=False)
            self.stats.digits += 1
            self.stats.char_count += 1
            self._at_boundary = False
            return

        if is_chinese_punctuation(ch):
            self._end_lexeme()
            self._end_symbol_run(count_word=False)
            self.stats.chinese_punctuations += 1
            self.stats.word_count += 1
            self.stats.char_count += 1
            self._at_boundary = False
            return

        if is_english_punctuation(ch):
            keeps_lexeme = self._lexeme_kind == "english" and ch in {"'", "-"}
            if not keeps_lexeme:
                had_lexeme = self._lexeme_kind is not None
                self._end_lexeme()
                if not had_lexeme and (self._symbol_run_length > 0 or self._at_boundary):
                    self._symbol_run_length += 1
            self.stats.english_punctuations += 1
            self.stats.char_count += 1
            if keeps_lexeme:
                self._at_boundary = False
            return

        if is_unicode_symbol(ch):
            self._write_symbol_char(ch)
            return

        self._end_lexeme()
        self._end_symbol_run(count_word=False)
        self._at_boundary = False

    def _write_char(self, ch: str) -> None:
        if ch.isspace():
            self._end_unit()
            self._at_boundary = True
            return

        if is_han(ch):
            self._end_lexeme()
            self._end_symbol_run(count_word=False)
            self.stats.han_chars += 1
            self.stats.word_count += 1
            self.stats.char_count += 1
            self._at_boundary = False
            return

        if is_ascii_letter(ch):
            self._end_symbol_run(count_word=False)
            self.stats.english_letters += 1
            self.stats.char_count += 1
            if self._lexeme_kind is None:
                self._lexeme_kind = "english"
            elif self._lexeme_kind == "number":
                self._lexeme_kind = "english"
            self._at_boundary = False
            return

        if is_digit(ch):
            self._end_symbol_run(count_word=False)
            self.stats.digits += 1
            self.stats.char_count += 1
            self._lexeme_has_digit = True
            if self._lexeme_kind is None:
                self._lexeme_kind = "number"
            self._at_boundary = False
            return

        if is_chinese_punctuation(ch):
            self._end_lexeme()
            self._end_symbol_run(count_word=False)
            self.stats.chinese_punctuations += 1
            self.stats.word_count += 1
            self.stats.char_count += 1
            self._at_boundary = False
            return

        if is_english_punctuation(ch):
            # Apostrophes/hyphens can connect English runs. Dot/comma/hyphen
            # can format numeric runs such as 3.14, 1,000, 2026-06-30, or
            # 7-9. Alphanumeric versions like v1.2.3 should remain one semantic
            # run too. These punctuations still count as characters.
            keeps_lexeme = (
                self._lexeme_kind == "english"
                and (ch in {"'", "-"} or (self._lexeme_has_digit and ch == "."))
            ) or (
                self._lexeme_kind == "number"
                and ch in {".", ",", "-"}
            )
            if not keeps_lexeme:
                had_lexeme = self._lexeme_kind is not None
                self._end_lexeme()
                if not had_lexeme and (self._symbol_run_length > 0 or self._at_boundary):
                    self._symbol_run_length += 1
            self.stats.english_punctuations += 1
            self.stats.char_count += 1
            if keeps_lexeme:
                self._at_boundary = False
            return

        if is_unicode_symbol(ch):
            self._write_symbol_char(ch)
            return

        self._end_lexeme()
        self._end_symbol_run(count_word=False)
        self._at_boundary = False

    def _write_visible_ascii_separator(self, text: str, index: int) -> bool:
        ch = text[index]
        if ch != "/" or index == 0 or index + 1 >= len(text):
            return False
        if not is_han(text[index - 1]) or not is_han(text[index + 1]):
            return False

        self._end_unit()
        self.stats.english_punctuations += 1
        self.stats.symbol_words += 1
        self.stats.word_count += 1
        self.stats.char_count += 1
        self._at_boundary = False
        return True

    def _write_ascii_compound_token(self, text: str, start: int) -> int:
        token = self._match_ascii_compound_token(text, start)
        if not token:
            return 0

        self._end_unit()
        self.stats.english_words += 1
        self.stats.word_count += 1
        for ch in token:
            if is_ascii_letter(ch):
                self.stats.english_letters += 1
                self.stats.char_count += 1
            elif is_digit(ch):
                self.stats.digits += 1
                self.stats.char_count += 1
            elif is_english_punctuation(ch):
                self.stats.english_punctuations += 1
                self.stats.char_count += 1
            elif is_unicode_symbol(ch):
                units = utf16_units(ch)
                self.stats.symbol_chars += units
                self.stats.char_count += units
            elif is_chinese_punctuation(ch):
                self.stats.chinese_punctuations += 1
                self.stats.char_count += 1
            elif is_han(ch):
                self.stats.han_chars += 1
                self.stats.char_count += 1
        self._at_boundary = False
        return len(token)

    def _match_ascii_compound_token(self, text: str, start: int) -> str | None:
        match = URL_TOKEN_RE.match(text, start)
        if match:
            return match.group(0)

        match = ASCII_COMPOUND_TOKEN_RE.match(text, start)
        if not match:
            return None
        token = match.group(0)
        if any(is_ascii_letter(ch) for ch in token):
            return token
        return None

    def _write_symbol_char(self, ch: str) -> None:
        self._end_lexeme()
        self._end_symbol_run(count_word=False)
        units = utf16_units(ch)
        self.stats.symbol_words += 1
        self.stats.symbol_chars += units
        self.stats.word_count += 1
        self.stats.char_count += units
        self._at_boundary = False

    def _end_unit(self) -> None:
        self._end_lexeme()
        self._end_symbol_run(count_word=True)

    def _end_lexeme(self) -> None:
        if self._lexeme_kind == "english":
            self.stats.english_words += 1
            self.stats.word_count += 1
        elif self._lexeme_kind == "number":
            self.stats.number_words += 1
            self.stats.word_count += 1
        self._lexeme_kind = None
        self._lexeme_has_digit = False

    def _end_symbol_run(self, *, count_word: bool) -> None:
        if self._symbol_run_length >= 1 and count_word:
            self.stats.symbol_words += 1
            self.stats.word_count += 1
        if self._symbol_run_length:
            self._at_boundary = False
        self._symbol_run_length = 0
