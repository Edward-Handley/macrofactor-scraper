from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="MACROFACTOR_",
        extra="ignore",
    )

    username: str | None = None
    password: str | None = None
    firebase_api_key: str | None = None
    firebase_project_id: str = "sbs-diet-app"
    firestore_database: str = "(default)"
    api_timeout_seconds: float = 20.0
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    dataset_paths: dict[str, str] = Field(
        default_factory=lambda: {
            "profile": "users/{uid}",
            "food_log": "users/{uid}/foodLogs/{date}",
            "nutrition": "users/{uid}/nutrition/{date}",
            "weight_log": "users/{uid}/weightLog",
            "workouts": "users/{uid}/workouts",
            "gyms": "users/{uid}/gymProfiles",
        }
    )

    @property
    def has_credentials(self) -> bool:
        return bool(self.username and self.password and self.firebase_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
