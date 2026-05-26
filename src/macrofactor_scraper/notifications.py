from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from macrofactor_scraper.health_export import HealthAutoExportService

logger = logging.getLogger(__name__)


def send_push(
    service: "HealthAutoExportService",
    title: str,
    body: str,
    url: str = "/",
    *,
    vapid_private_key: str,
    vapid_contact: str,
) -> int:
    """Send push notification to all stored subscriptions. Returns count of successful sends."""
    from pywebpush import webpush, WebPushException

    subs = service.get_push_subscriptions()
    if not subs:
        return 0

    payload = json.dumps({"title": title, "body": body, "url": url})
    sent = 0
    dead: list[int] = []

    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=payload,
                vapid_private_key=vapid_private_key,
                vapid_claims={"sub": f"mailto:{vapid_contact}"},
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):
                dead.append(sub["id"])
                logger.info("Removing stale push subscription id=%s (HTTP %s)", sub["id"], status)
            else:
                logger.warning("Push failed for sub id=%s: %s", sub["id"], exc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Push error for sub id=%s: %s", sub["id"], exc)

    for sub_id in dead:
        service.delete_push_subscription_by_id(sub_id)

    return sent
