"""stowge CLI – admin utilities for managing users from the container shell."""

import argparse
import getpass
import sys


def _get_db():
    """Return an open SQLAlchemy session using the same env config as the server."""
    from stowge.db import SessionLocal, engine, Base  # noqa: PLC0415
    Base.metadata.create_all(bind=engine)
    return SessionLocal()


# ── commands ──────────────────────────────────────────────────────────────────

def cmd_help(_args=None):
    print(
        "stowge admin CLI\n"
        "\n"
        "Commands:\n"
        "  stowge help\n"
        "      Show this help message.\n"
        "\n"
        "  stowge admin create --email <email>\n"
        "      Create a new admin user. Prompts for a password.\n"
        "\n"
        "  stowge reset-password --email <email>\n"
        "      Set a new password for an existing user.\n"
        "\n"
        "  stowge users list\n"
        "      List all users.\n"
    )


def cmd_admin_create(args):
    from stowge.models import User        # noqa: PLC0415
    from stowge.auth import hash_password  # noqa: PLC0415

    email = args.email.strip().lower()

    db = _get_db()
    try:
        existing = db.query(User).filter(User.username == email).first()
        if existing:
            print(f"User '{email}' already exists.")
            print("\nPassword can be reset with:")
            print(f"  stowge reset-password --email {email}")
            return

        password = getpass.getpass("Password: ")
        if not password:
            print("Error: Password cannot be empty.", file=sys.stderr)
            sys.exit(1)
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Error: Passwords do not match.", file=sys.stderr)
            sys.exit(1)

        user = User(
            username=email,
            password_hash=hash_password(password),
            role="admin",
        )
        db.add(user)
        db.commit()
        print(f"Admin user '{email}' created.")
        print("\nPassword can be reset with:")
        print(f"  stowge reset-password --email {email}")
    finally:
        db.close()


def cmd_reset_password(args):
    from stowge.models import User        # noqa: PLC0415
    from stowge.auth import hash_password  # noqa: PLC0415

    email = args.email.strip().lower()

    db = _get_db()
    try:
        user = db.query(User).filter(User.username == email).first()
        if not user:
            print(f"Error: No user found with email '{email}'.", file=sys.stderr)
            sys.exit(1)

        password = getpass.getpass(f"New password for {email}: ")
        if not password:
            print("Error: Password cannot be empty.", file=sys.stderr)
            sys.exit(1)
        confirm = getpass.getpass("Confirm new password: ")
        if password != confirm:
            print("Error: Passwords do not match.", file=sys.stderr)
            sys.exit(1)

        user.password_hash = hash_password(password)
        db.commit()
        print(f"Password updated for '{email}'.")
    finally:
        db.close()


def cmd_users_list(_args):
    from stowge.models import User  # noqa: PLC0415

    db = _get_db()
    try:
        users = db.query(User).order_by(User.username.asc()).all()
        if not users:
            print("No users found.")
            return

        for user in users:
            print(f"{user.username} ({user.role})")
    finally:
        db.close()


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(prog="stowge", add_help=False)
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("help", help="Show this help message")

    admin_parser = subparsers.add_parser("admin", help="Admin management commands")
    admin_sub = admin_parser.add_subparsers(dest="admin_command")
    admin_create_parser = admin_sub.add_parser("create", help="Create a new admin user")
    admin_create_parser.add_argument("--email", required=True, metavar="EMAIL",
                                     help="Email address for the new admin user")

    reset_parser = subparsers.add_parser("reset-password", help="Reset a user's password")
    reset_parser.add_argument("--email", required=True, metavar="EMAIL",
                              help="Email address of the user")

    users_parser = subparsers.add_parser("users", help="User management commands")
    users_sub = users_parser.add_subparsers(dest="users_command")
    users_sub.add_parser("list", help="List all users")

    args = parser.parse_args()

    if args.command == "help" or args.command is None:
        cmd_help(args)
    elif args.command == "admin":
        if args.admin_command == "create":
            cmd_admin_create(args)
        else:
            admin_parser.print_help()
    elif args.command == "reset-password":
        cmd_reset_password(args)
    elif args.command == "users":
        if args.users_command == "list":
            cmd_users_list(args)
        else:
            users_parser.print_help()


if __name__ == "__main__":
    main()
