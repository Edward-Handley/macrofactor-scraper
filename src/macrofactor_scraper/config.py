from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="MACROFACTOR_",
        extra="ignore",
        populate_by_name=True,
    )

    ingest_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "HEALTH_EXPORT_API_KEY",
            "INGEST_API_KEY",
            "MACROFACTOR_HEALTH_EXPORT_API_KEY",
        ),
    )
    read_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "HEALTH_EXPORT_READ_API_KEY",
            "READ_API_KEY",
            "MACROFACTOR_HEALTH_EXPORT_READ_API_KEY",
        ),
    )
    sqlite_path: str = Field(
        default="health_export.sqlite3",
        validation_alias=AliasChoices(
            "HEALTH_EXPORT_SQLITE_PATH",
            "SQLITE_PATH",
            "MACROFACTOR_SQLITE_PATH",
        ),
    )
    environment: Literal["development", "production"] = Field(
        default="development",
        validation_alias=AliasChoices("ENVIRONMENT", "APP_ENV", "MACROFACTOR_ENVIRONMENT"),
    )
    session_secret: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SESSION_SECRET", "MACROFACTOR_SESSION_SECRET"),
    )
    dashboard_password: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DASHBOARD_PASSWORD", "MACROFACTOR_DASHBOARD_PASSWORD"),
    )
    username: str | None = Field(default=None, validation_alias=AliasChoices("MACROFACTOR_USERNAME"))
    password: str | None = Field(default=None, validation_alias=AliasChoices("MACROFACTOR_PASSWORD"))
    firebase_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "FIREBASE_WEB_API_KEY",
            "VITE_FIREBASE_WEB_API_KEY",
            "MACROFACTOR_FIREBASE_API_KEY",
        ),
    )
    firebase_project_id: str = "sbs-diet-app"
    firestore_database: str = "(default)"
    api_timeout_seconds: float = 20.0
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    dataset_paths: dict[str, str] = Field(
        default_factory=lambda: {
            "profile": "users/{uid}",
            "food_log": "users/{uid}/food/{date}",
            "nutrition": "users/{uid}/nutrition/{year}",
            "weight_log": "users/{uid}/scale/{year}",
            "steps": "users/{uid}/steps/{year}",
            "workouts": "users/{uid}/workoutHistory",
            "gyms": "users/{uid}/gym",
            "custom_exercises": "users/{uid}/customExercises",
            "workout_profile": "users/{uid}/profiles/workout",
            "diet_profile": "users/{uid}/profiles/diet",
            "training_programs": "users/{uid}/trainingProgram",
        }
    )

    @property
    def has_credentials(self) -> bool:
        return bool(self.username and self.password and self.firebase_api_key)

    @property
    def dashboard_secret(self) -> str | None:
        return self.dashboard_password or self.ingest_api_key

    @property
    def effective_session_secret(self) -> str | None:
        return self.session_secret or self.ingest_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
