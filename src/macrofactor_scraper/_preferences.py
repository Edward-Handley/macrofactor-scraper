"""Private preference-normalization helpers — import via HealthAutoExportService."""
from __future__ import annotations

from macrofactor_scraper._aggregation import SUMMARY_FIELDS
from macrofactor_scraper.models import DashboardPreferences, WorkoutPreferences


def _normalize_preferences(preferences: DashboardPreferences) -> DashboardPreferences:
    known_fields = set(SUMMARY_FIELDS)
    visible = [field for field in preferences.visible_summary_cards if field in known_fields]
    hidden = [field for field in preferences.hidden_summary_fields if field in known_fields]
    chart_set = [field for field in preferences.default_chart_set if field in known_fields]
    source_filters = {
        str(metric): [str(source) for source in sources if str(source)]
        for metric, sources in preferences.source_filters.items()
        if str(metric) and sources
    }
    return DashboardPreferences(
        visible_summary_cards=visible or list(SUMMARY_FIELDS),
        hidden_summary_fields=hidden,
        preferred_range_days=max(1, min(365, int(preferences.preferred_range_days))),
        trusted_metric_names=sorted({name for name in preferences.trusted_metric_names if name}),
        untrusted_metric_names=sorted({name for name in preferences.untrusted_metric_names if name}),
        default_chart_set=chart_set or ["calories", "protein", "carbohydrates", "fat", "active_energy"],
        source_filters=source_filters,
        workout_preferences=_normalize_workout_preferences(preferences.workout_preferences),
    )


def _normalize_workout_preferences(preferences: WorkoutPreferences) -> WorkoutPreferences:
    tabs = {"Overview", "Sessions", "Exercises", "Nutrition", "Customize"}
    cards = {"sessions", "volume", "prs", "protein", "calorie_delta", "load_trend"}
    charts = {"training_heatmap", "weekly_group_load", "nutrition_scatter", "group_balance", "exercise_progress", "session_timeline"}
    sorts = {"recent_pr", "volume", "last_performed", "estimated_1rm_delta"}
    visible_cards = [card for card in preferences.visible_workout_cards if card in cards]
    default_charts = [chart for chart in preferences.default_charts if chart in charts]
    return WorkoutPreferences(
        default_range_days=max(7, min(3650, int(preferences.default_range_days))),
        landing_tab=preferences.landing_tab if preferences.landing_tab in tabs else "Overview",
        visible_workout_cards=visible_cards or ["sessions", "volume", "prs", "protein", "calorie_delta", "load_trend"],
        default_charts=default_charts or ["training_heatmap", "weekly_group_load", "nutrition_scatter", "group_balance"],
        pinned_exercises=sorted({name.strip() for name in preferences.pinned_exercises if name.strip()}),
        default_group_filter=preferences.default_group_filter.strip() or "All",
        default_exercise_sort=preferences.default_exercise_sort if preferences.default_exercise_sort in sorts else "recent_pr",
        show_import_panel=bool(preferences.show_import_panel),
    )


def _effective_hidden_fields(preferences: DashboardPreferences | None) -> list[str]:
    if preferences is None:
        return []
    visible = set(preferences.visible_summary_cards)
    hidden = set(preferences.hidden_summary_fields)
    return [field for field in SUMMARY_FIELDS if field in hidden or field not in visible]
