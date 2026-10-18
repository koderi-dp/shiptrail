"""Isolated real HTTP/SSE engine for Playwright; never invokes a provider CLI."""

import argparse
import json
import os
from pathlib import Path
import sys

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from engine_harness import StubAdapter, create_repo
from shiptrail.api.app import create_app
from shiptrail.engine import gitops
from shiptrail.engine.runtime import Runtime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    os.environ["SHIPTRAIL_HOME"] = str(args.root / "machine")
    if not (args.root / "ready.json").exists():
        ids = []
        for name in ("alpha", "beta"):
            root = args.root / name
            ids.append(create_repo(root, jobs=0))
            config_path = root / ".shiptrail/config.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            task = {
                "id": "build",
                "uses": "builder",
                "provider": "codex",
                "profiles": {
                    "codex": {
                        "model": "fake",
                        "effort": "low"
                    },
                    "opencode": {
                        "model": "saved-profile",
                        "effort": "low"
                    }
                }
            }
            config["pipelines"]["test"].insert(0, task)
            config_path.write_text(json.dumps(config))
            (root / "scenario.json").write_text(
                json.dumps({
                    "sleep": 4,
                    "event_delay": 1,
                    "events": [{
                        "activity": "Reading request"
                    }, {
                        "activity": "working č"
                    }]
                }))
            for command in [("init", "-qb", "main"), ("config", "user.name", "E2E"),
                            ("config", "user.email", "e2e@localhost"),
                            ("config", "commit.gpgsign", "false")]:
                gitops.checked(*command, cwd=root)
            (root / ".gitignore").write_text(".shiptrail/jobs/\nfactory/repo.db*\ninvocations/\n")
            gitops.checked("add", ".", cwd=root)
            gitops.checked("commit", "-qm", "fixture", cwd=root)
        (args.root / "ready.json").write_text(json.dumps(ids))
    runtime = Runtime({"codex": StubAdapter()})
    uvicorn.run(create_app(port=args.port, token="e2e-token", runtime=runtime),
                host="127.0.0.1",
                port=args.port,
                timeout_graceful_shutdown=1)


if __name__ == "__main__":
    main()
