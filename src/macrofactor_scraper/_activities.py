"""Activity CRUD, goals CRUD, training recommendation/review service methods."""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from macrofactor_scraper._utils import _fingerprint


def _row_to_activity(row: sqlite3.Row) -> dict:
    d = dict(row)
    for field in ("hr_zones_json", "laps_json"):
        if field in d and d[field]:
            try:
                d[field.replace("_json", "")] = json.loads(d.pop(field))
            except Exception:
                d[field.replace("_json", "")] = []
                d.pop(field, None)
        else:
            d[field.replace("_json", "")] = None
            d.pop(field, None)
    return d


# ─── Activities ───────────────────────────────────────────────────────────────

def get_activity_by_garmin_id(conn: sqlite3.Connection, garmin_activity_id: int) -> dict | None:
    row = conn.execute(
        "SELECT * FROM activities WHERE garmin_activity_id = ?", (garmin_activity_id,)
    ).fetchone()
    return _row_to_activity(row) if row else None


def upsert_garmin_activity(conn: sqlite3.Connection, payload: dict) -> bool:
    """Insert or update a Garmin activity row. Returns True if inserted/changed."""
    garmin_id = payload["garmin_activity_id"]
    fp = _fingerprint("garmin_activity_v1", str(garmin_id))
    hr_zones = json.dumps(payload.get("hr_zones")) if payload.get("hr_zones") is not None else None
    laps = json.dumps(payload.get("laps")) if payload.get("laps") is not None else None
    raw = json.dumps(payload.get("raw", {}))

    existing = conn.execute(
        "SELECT id FROM activities WHERE garmin_activity_id = ?", (garmin_id,)
    ).fetchone()

    if existing:
        conn.execute(
            """
            UPDATE activities SET
                sport = ?, activity_date = ?, start_time = ?, duration_seconds = ?,
                distance_m = ?, calories = ?, avg_hr = ?, max_hr = ?,
                aerobic_te = ?, anaerobic_te = ?, training_load = ?, load_source = ?,
                pool_length_m = ?, laps = ?, total_strokes = ?, avg_swolf = ?,
                avg_pace_s_per_100m = ?, stroke_type = ?, hr_zones_json = ?, laps_json = ?,
                raw_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE garmin_activity_id = ?
            """,
            (
                payload.get("sport"), payload.get("activity_date"), payload.get("start_time"),
                payload.get("duration_seconds"), payload.get("distance_m"), payload.get("calories"),
                payload.get("avg_hr"), payload.get("max_hr"), payload.get("aerobic_te"),
                payload.get("anaerobic_te"), payload.get("training_load"), payload.get("load_source"),
                payload.get("pool_length_m"), payload.get("laps"), payload.get("total_strokes"),
                payload.get("avg_swolf"), payload.get("avg_pace_s_per_100m"), payload.get("stroke_type"),
                hr_zones, laps, raw, garmin_id,
            ),
        )
        return False
    else:
        conn.execute(
            """
            INSERT INTO activities (
                source, garmin_activity_id, sport, activity_date, start_time,
                duration_seconds, distance_m, calories, avg_hr, max_hr,
                aerobic_te, anaerobic_te, training_load, load_source,
                pool_length_m, laps, total_strokes, avg_swolf,
                avg_pace_s_per_100m, stroke_type, hr_zones_json, laps_json,
                raw_json, fingerprint
            ) VALUES (
                'garmin', ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?
            )
            """,
            (
                garmin_id, payload.get("sport"), payload.get("activity_date"), payload.get("start_time"),
                payload.get("duration_seconds"), payload.get("distance_m"), payload.get("calories"),
                payload.get("avg_hr"), payload.get("max_hr"), payload.get("aerobic_te"),
                payload.get("anaerobic_te"), payload.get("training_load"), payload.get("load_source"),
                payload.get("pool_length_m"), payload.get("laps"), payload.get("total_strokes"),
                payload.get("avg_swolf"), payload.get("avg_pace_s_per_100m"), payload.get("stroke_type"),
                hr_zones, laps, raw, fp,
            ),
        )
        return True


def create_manual_activity(conn: sqlite3.Connection, payload: dict) -> dict:
    sport = payload["sport"]
    start_time = payload.get("start_time", "")
    duration_seconds = (payload.get("duration_minutes") or 0) * 60
    rpe = payload.get("rpe")
    training_load = round(duration_seconds / 60 * rpe, 1) if rpe else None
    fp = _fingerprint("manual_activity_v1", sport, start_time, str(duration_seconds))

    conn.execute(
        """
        INSERT INTO activities (
            source, sport, activity_date, start_time, duration_seconds,
            distance_m, calories, rpe, perceived_intensity, training_load, load_source,
            notes, raw_json, fingerprint
        ) VALUES ('manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'session_rpe', ?, '{}', ?)
        """,
        (
            sport, payload.get("activity_date"), start_time, duration_seconds,
            payload.get("distance_m"), payload.get("calories"), rpe,
            payload.get("perceived_intensity"), training_load, payload.get("notes"), fp,
        ),
    )
    row = conn.execute("SELECT * FROM activities WHERE fingerprint = ?", (fp,)).fetchone()
    return _row_to_activity(row)


def update_manual_activity(conn: sqlite3.Connection, activity_id: int, payload: dict) -> dict | None:
    existing = conn.execute(
        "SELECT * FROM activities WHERE id = ? AND source = 'manual'", (activity_id,)
    ).fetchone()
    if not existing:
        return None

    allowed = {
        "sport", "activity_date", "start_time", "rpe", "perceived_intensity",
        "distance_m", "calories", "notes",
    }
    updates = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if "duration_minutes" in payload:
        updates["duration_seconds"] = (payload["duration_minutes"] or 0) * 60

    rpe = updates.get("rpe", existing["rpe"])
    dur_secs = updates.get("duration_seconds", existing["duration_seconds"])
    if rpe is not None and dur_secs is not None:
        updates["training_load"] = round(dur_secs / 60 * rpe, 1)
        updates["load_source"] = "session_rpe"

    if not updates:
        return _row_to_activity(existing)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    set_clause += ", updated_at = CURRENT_TIMESTAMP"
    conn.execute(
        f"UPDATE activities SET {set_clause} WHERE id = ?",
        (*updates.values(), activity_id),
    )
    row = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
    return _row_to_activity(row)


def delete_activity(conn: sqlite3.Connection, activity_id: int, force: bool = False) -> bool:
    row = conn.execute("SELECT source FROM activities WHERE id = ?", (activity_id,)).fetchone()
    if not row:
        return False
    if row["source"] == "garmin" and not force:
        raise ValueError("Cannot delete Garmin activity without force=True")
    conn.execute("DELETE FROM activities WHERE id = ?", (activity_id,))
    return True


def list_activities(
    conn: sqlite3.Connection,
    start: str,
    end: str,
    sport: str | None = None,
    limit: int = 200,
) -> list[dict]:
    if sport:
        rows = conn.execute(
            """
            SELECT * FROM activities
            WHERE activity_date BETWEEN ? AND ? AND sport = ?
            ORDER BY activity_date DESC, start_time DESC
            LIMIT ?
            """,
            (start, end, sport, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT * FROM activities
            WHERE activity_date BETWEEN ? AND ?
            ORDER BY activity_date DESC, start_time DESC
            LIMIT ?
            """,
            (start, end, limit),
        ).fetchall()
    return [_row_to_activity(r) for r in rows]


def get_activity(conn: sqlite3.Connection, activity_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
    return _row_to_activity(row) if row else None


# ─── Performance goals ────────────────────────────────────────────────────────

def list_goals(conn: sqlite3.Connection, active_only: bool = True) -> list[dict]:
    if active_only:
        rows = conn.execute(
            "SELECT * FROM performance_goals WHERE active = 1 ORDER BY created_at DESC"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM performance_goals ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def create_goal(conn: sqlite3.Connection, payload: dict) -> dict:
    cursor = conn.execute(
        """
        INSERT INTO performance_goals (name, goal_type, sport, target_value, unit, target_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload["name"], payload["goal_type"], payload.get("sport"),
            payload.get("target_value"), payload.get("unit"),
            payload.get("target_date"), payload.get("notes"),
        ),
    )
    row = conn.execute("SELECT * FROM performance_goals WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


def update_goal(conn: sqlite3.Connection, goal_id: int, payload: dict) -> dict | None:
    allowed = {"name", "goal_type", "sport", "target_value", "unit", "target_date", "active", "notes"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if not updates:
        row = conn.execute("SELECT * FROM performance_goals WHERE id = ?", (goal_id,)).fetchone()
        return dict(row) if row else None
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    conn.execute(
        f"UPDATE performance_goals SET {set_clause} WHERE id = ?",
        (*updates.values(), goal_id),
    )
    row = conn.execute("SELECT * FROM performance_goals WHERE id = ?", (goal_id,)).fetchone()
    return dict(row) if row else None


def delete_goal(conn: sqlite3.Connection, goal_id: int) -> bool:
    result = conn.execute("DELETE FROM performance_goals WHERE id = ?", (goal_id,))
    return result.rowcount > 0


# ─── Training recommendations ─────────────────────────────────────────────────

def get_training_recommendation(conn: sqlite3.Connection, rec_date: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM daily_training_recommendations WHERE rec_date = ?", (rec_date,)
    ).fetchone()
    return dict(row) if row else None


def upsert_training_recommendation(
    conn: sqlite3.Connection, rec_date: str, recommendation: str, model: str, tokens_used: int
) -> None:
    conn.execute(
        """
        INSERT INTO daily_training_recommendations (rec_date, recommendation, model, tokens_used, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(rec_date) DO UPDATE SET
            recommendation = excluded.recommendation,
            model = excluded.model,
            tokens_used = excluded.tokens_used,
            created_at = excluded.created_at
        """,
        (rec_date, recommendation, model, tokens_used),
    )


# ─── Performance weekly reviews ───────────────────────────────────────────────

def get_performance_review(conn: sqlite3.Connection, week_start_date: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM performance_weekly_reviews WHERE week_start_date = ?", (week_start_date,)
    ).fetchone()
    if not row:
        return None
    r = dict(row)
    r["highlights"] = json.loads(r.pop("highlights_json", "[]"))
    return r


def upsert_performance_review(
    conn: sqlite3.Connection,
    week_start_date: str,
    narrative: str,
    highlights: list[Any],
    model: str,
    tokens_used: int,
) -> None:
    conn.execute(
        """
        INSERT INTO performance_weekly_reviews (week_start_date, narrative, highlights_json, model, tokens_used, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(week_start_date) DO UPDATE SET
            narrative = excluded.narrative,
            highlights_json = excluded.highlights_json,
            model = excluded.model,
            tokens_used = excluded.tokens_used,
            created_at = excluded.created_at
        """,
        (week_start_date, narrative, json.dumps(highlights), model, tokens_used),
    )


def list_performance_reviews(conn: sqlite3.Connection, limit: int = 52) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM performance_weekly_reviews ORDER BY week_start_date DESC LIMIT ?", (limit,)
    ).fetchall()
    result = []
    for row in rows:
        r = dict(row)
        r["highlights"] = json.loads(r.pop("highlights_json", "[]"))
        result.append(r)
    return result
