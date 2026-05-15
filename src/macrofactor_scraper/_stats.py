"""Private statistical helpers — import via HealthAutoExportService, not directly."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from macrofactor_scraper.models import StrongTrainingRestDelta


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _date_delta(days: int) -> timedelta:
    return timedelta(days=days)


def _avg(values: Iterable[float | None]) -> float | None:
    nums = [float(value) for value in values if value is not None]
    return sum(nums) / len(nums) if nums else None


def _pearson(pairs: Iterable[tuple[float, float]]) -> float | None:
    values = list(pairs)
    if len(values) < 2:
        return None
    xs = [pair[0] for pair in values]
    ys = [pair[1] for pair in values]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    numerator = sum((x - mean_x) * (y - mean_y) for x, y in values)
    denom_x = sum((x - mean_x) ** 2 for x in xs)
    denom_y = sum((y - mean_y) ** 2 for y in ys)
    denominator = (denom_x * denom_y) ** 0.5
    if denominator == 0:
        return None
    return numerator / denominator


def _training_rest_delta(metric: str, training: float | None, rest: float | None) -> "StrongTrainingRestDelta":
    from macrofactor_scraper.models import StrongTrainingRestDelta
    return StrongTrainingRestDelta(
        metric=metric,
        training_average=training,
        rest_average=rest,
        delta=training - rest if training is not None and rest is not None else None,
    )
