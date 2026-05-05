from __future__ import annotations


class MacroFactorError(Exception):
    """Base exception for expected MacroFactor backend failures."""


class ConfigurationError(MacroFactorError):
    """Raised when required local configuration is missing."""


class AuthenticationError(MacroFactorError):
    """Raised when Firebase authentication fails."""


class UpstreamError(MacroFactorError):
    """Raised when Firebase or Firestore returns an unexpected response."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
