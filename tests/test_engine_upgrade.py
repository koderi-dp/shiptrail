"""`shiptrail upgrade` keeps a repository in step with the installed engine."""

import json

import pytest

from shiptrail import __version__, cli, service
from shiptrail.engine import scaffold, versioning
from test_engine_api import initialise, repo  # noqa: F401  (fixture)


def snapshot(root):
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in root.rglob("*") if p.is_file() and ".git" not in p.relative_to(root).parts
    }


def test_upgrade_updates_the_engine_gate_and_leaves_custom_roles_alone(repo):  # noqa: F811
    initialise(repo)
    config = repo / ".shiptrail/config.json"
    raw = json.loads(config.read_text())
    raw["engine"] = ">=999,<1000"
    config.write_text(json.dumps(raw))
    override = repo / ".shiptrail/roles/builder.codex.md"
    override.parent.mkdir()
    override.write_text("---\ntype: task\n---\nKeep this text.\n")
    before = override.read_bytes()
    assert cli.main(["--repo", str(repo), "upgrade"]) == 0
    versioning.check(repo)
    assert override.read_bytes() == before


def test_upgrade_dry_run_writes_nothing_and_an_up_to_date_repo_has_nothing_to_do(
        repo):  # noqa: F811
    initialise(repo)
    wrapper = repo / ".agents/skills/shiptrail/SKILL.md"
    wrapper.write_text("an older shortcut\n", encoding="utf-8")
    before = snapshot(repo)
    plan = scaffold.upgrade(repo, dry_run=True)
    assert ".agents/skills/shiptrail/SKILL.md" in plan
    assert snapshot(repo) == before
    scaffold.upgrade(repo)
    assert scaffold.upgrade(repo, dry_run=True) == "Already up to date."


def test_upgrade_leaves_a_current_config_in_its_own_formatting(repo):  # noqa: F811
    initialise(repo)
    config = repo / ".shiptrail/config.json"
    config.write_text(json.dumps(json.loads(config.read_text())), encoding="utf-8")
    assert scaffold.upgrade(repo, dry_run=True) == "Already up to date."


def test_upgrade_rejects_a_config_in_an_unsupported_format(repo):  # noqa: F811
    initialise(repo)
    config = repo / ".shiptrail/config.json"
    config.write_text(json.dumps({"provider": "codex"}))
    with pytest.raises(ValueError, match="expected 2"):
        scaffold.upgrade(repo)


def test_upgrade_restarts_an_older_service_but_dry_run_does_not(repo, monkeypatch):  # noqa: F811
    initialise(repo)
    old = {"version": __version__ + ".old"}
    restarted = []
    monkeypatch.setattr(service, "info", lambda: old)
    monkeypatch.setattr(service, "healthy", lambda data: True)
    monkeypatch.setattr(service, "ensure", lambda: restarted.append(True))
    assert cli.main(["--repo", str(repo), "upgrade", "--dry-run"]) == 0
    assert restarted == []
    assert cli.main(["--repo", str(repo), "upgrade"]) == 0
    assert restarted == [True]
