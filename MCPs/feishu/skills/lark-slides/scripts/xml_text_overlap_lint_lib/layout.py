# Copyright (c) 2026 Lark Technologies Pte. Ltd.
# SPDX-License-Identifier: MIT

from __future__ import annotations

import math
from typing import Any


def sum_sizes(sizes: list[int | float]) -> int | float:
    return sum(sizes)


def is_filled_size(size: int | float | None) -> bool:
    return isinstance(size, (int, float)) and math.isfinite(size) and size > 0


def fill_last_size_gap(sizes: list[int | float], target_size: int | float) -> list[int | float]:
    if not sizes:
        return sizes
    final_sizes = [
        size if index == len(sizes) - 1 else max(1, math.floor(size + 0.5))
        for index, size in enumerate(sizes)
    ]
    remaining_size = target_size - sum_sizes(final_sizes[:-1])
    if remaining_size >= 1:
        final_sizes[-1] = remaining_size
        return final_sizes

    size_to_redistribute = 1 - remaining_size
    for index in range(len(final_sizes) - 2, -1, -1):
        reduction = min(final_sizes[index] - 1, size_to_redistribute)
        final_sizes[index] -= reduction
        size_to_redistribute -= reduction
        if size_to_redistribute == 0:
            final_sizes[-1] = 1
            return final_sizes

    final_sizes[-1] = 1
    return final_sizes


def solve_weighted_min_layout(
    input_sizes: list[int | float | None], default_size: int | float, target_min_size: int | float | None
) -> dict[str, Any]:
    filled_indexes: list[int] = []
    empty_indexes: list[int] = []
    base_sizes: list[int | float] = []
    for index, size in enumerate(input_sizes):
        if is_filled_size(size):
            filled_indexes.append(index)
            base_sizes.append(size)
        else:
            empty_indexes.append(index)
            base_sizes.append(0)
    filled_sum = sum_sizes(base_sizes)

    if target_min_size is None:
        final_sizes = [default_size if index in empty_indexes else size for index, size in enumerate(base_sizes)]
        return {"final_sizes": final_sizes, "actual_size": sum_sizes(final_sizes), "ratio": 1}

    if not filled_indexes:
        average_size = target_min_size / len(input_sizes)
        final_sizes = fill_last_size_gap([average_size] * len(input_sizes), target_min_size)
        return {"final_sizes": final_sizes, "actual_size": sum_sizes(final_sizes), "ratio": 1}

    if empty_indexes:
        remaining_size = target_min_size - filled_sum
        final_sizes = [*base_sizes]
        if remaining_size > 0:
            average_size = remaining_size / len(empty_indexes)
            empty_sizes = fill_last_size_gap([average_size] * len(empty_indexes), remaining_size)
            for index, empty_size in zip(empty_indexes, empty_sizes):
                final_sizes[index] = empty_size
        else:
            for index in empty_indexes:
                final_sizes[index] = default_size
        return {"final_sizes": final_sizes, "actual_size": sum_sizes(final_sizes), "ratio": 1}

    ratio = max(1, target_min_size / filled_sum)
    actual_size = max(target_min_size, filled_sum)
    if ratio == 1:
        return {"final_sizes": [*base_sizes], "actual_size": actual_size, "ratio": ratio}
    final_sizes = fill_last_size_gap([size * ratio for size in base_sizes], actual_size)
    return {"final_sizes": final_sizes, "actual_size": sum_sizes(final_sizes), "ratio": ratio}
