"""CLI: generate an argon2id hash for DASHBOARD_PASSWORD_HASH.

Usage:
    python -m macrofactor_scraper.hash_password
"""
from __future__ import annotations

import getpass
import sys


def main() -> None:
    try:
        from argon2 import PasswordHasher
    except ImportError:
        print("argon2-cffi not installed. Run: pip install argon2-cffi", file=sys.stderr)
        sys.exit(1)

    password = getpass.getpass("Dashboard password: ")
    if not password:
        print("Password cannot be empty.", file=sys.stderr)
        sys.exit(1)

    ph = PasswordHasher()
    hashed = ph.hash(password)
    print(f"\nAdd to .env:\n\nDASHBOARD_PASSWORD_HASH={hashed}\n")


if __name__ == "__main__":
    main()
