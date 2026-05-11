"""One-shot repair tool for running-total nutrition stacking.

Usage:
    python -m macrofactor_scraper.repair --dry-run
    python -m macrofactor_scraper.repair --apply [--start YYYY-MM-DD] [--end YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

from macrofactor_scraper.config import get_settings
from macrofactor_scraper.health_export import HealthAutoExportService
from macrofactor_scraper.models import RepairReport


def _format_report(report: RepairReport) -> str:
    lines: list[str] = []
    mode = "DRY RUN" if report.dry_run else "APPLIED"
    lines.append(f"\n=== Repair Report ({mode}) ===")
    lines.append(f"Groups inspected : {report.groups_inspected}")
    lines.append(f"Rows removed     : {report.rows_removed}")
    if report.backup_path:
        lines.append(f"Backup written   : {report.backup_path}")

    if not report.deltas:
        lines.append("\nNo stacked groups found — nothing to clean.")
        return "\n".join(lines)

    lines.append(
        f"\n{'Date':<12} {'Metric':<22} {'Source':<20} {'Before':>10} {'After':>10} {'Removed':>8}"
    )
    lines.append("-" * 88)
    for delta in sorted(report.deltas, key=lambda d: (d.date, d.metric_name, d.source or "")):
        lines.append(
            f"{delta.date!s:<12} {delta.metric_name:<22} {(delta.source or ''):<20}"
            f" {delta.before_total:>10.1f} {delta.after_total:>10.1f} {len(delta.removed_row_ids):>8}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Repair running-total nutrition stacking in the SQLite DB.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Show what would change without deleting anything.")
    mode.add_argument("--apply", action="store_true", help="Delete redundant rows (writes a JSON backup first).")
    parser.add_argument("--start", metavar="YYYY-MM-DD", help="Only inspect records from this date onward.")
    parser.add_argument("--end", metavar="YYYY-MM-DD", help="Only inspect records up to this date.")
    parser.add_argument("--sqlite-path", metavar="PATH", help="Path to the SQLite file (overrides env).")
    parser.add_argument("--backup-dir", metavar="DIR", default="repair_backups", help="Directory for backup JSON (default: repair_backups).")

    args = parser.parse_args(argv)

    start: date | None = None
    end: date | None = None
    if args.start:
        start = date.fromisoformat(args.start)
    if args.end:
        end = date.fromisoformat(args.end)

    settings = get_settings()
    sqlite_path = args.sqlite_path or settings.sqlite_path
    service = HealthAutoExportService(sqlite_path)

    report = service.repair_running_totals(
        start,
        end,
        dry_run=not args.apply,
        backup_dir=Path(args.backup_dir) if args.apply else None,
    )
    print(_format_report(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
