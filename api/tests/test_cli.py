import argparse

from stowge.auth import verify_password
from stowge.cli import cmd_help, cmd_reset_password, cmd_users_list, main
from stowge.models import User


def test_cmd_users_list_empty_prints_message(isolated_db, monkeypatch, capsys):
    db = isolated_db()
    monkeypatch.setattr("stowge.cli._get_db", lambda: db)

    cmd_users_list(None)

    out = capsys.readouterr().out
    assert out.strip() == "No users found."


def test_cmd_users_list_prints_sorted_users(isolated_db, monkeypatch, capsys):
    db = isolated_db()
    db.add(User(username="zeta@example.com", password_hash="h1", role="user"))
    db.add(User(username="alpha@example.com", password_hash="h2", role="admin"))
    db.commit()

    monkeypatch.setattr("stowge.cli._get_db", lambda: db)

    cmd_users_list(None)

    lines = [line.strip() for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert lines == [
        "alpha@example.com (admin)",
        "zeta@example.com (user)",
    ]


def test_help_includes_users_list(capsys):
    cmd_help()
    out = capsys.readouterr().out

    assert "stowge users list" in out


def test_main_dispatches_users_list(monkeypatch):
    called = {"value": False}

    def fake_cmd(_args):
        called["value"] = True

    monkeypatch.setattr("stowge.cli.cmd_users_list", fake_cmd)
    monkeypatch.setattr("sys.argv", ["stowge", "users", "list"])

    main()

    assert called["value"] is True


def test_cmd_reset_password_accepts_short_non_empty_password(isolated_db, monkeypatch, capsys):
    db = isolated_db()
    user = User(username="reset@example.com", password_hash="oldhash", role="admin")
    db.add(user)
    db.commit()

    monkeypatch.setattr("stowge.cli._get_db", lambda: db)
    answers = iter(["x", "x"])
    monkeypatch.setattr("getpass.getpass", lambda _prompt: next(answers))

    cmd_reset_password(argparse.Namespace(email="reset@example.com"))

    updated_user = db.query(User).filter(User.username == "reset@example.com").first()
    assert updated_user is not None
    assert verify_password("x", updated_user.password_hash) is True
    out = capsys.readouterr().out
    assert "Password updated" in out
