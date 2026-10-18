# Changelog

## [Unreleased]

- The project folder is now the hidden `.shiptrail/` (it was `shiptrail/`). A project set up with
  0.1.0 needs it moved: `git mv shiptrail .shiptrail`, then change the two `.gitignore` lines
  to `/.shiptrail/state/` and `/.shiptrail/jobs/`. `shiptrail init` creates `.shiptrail/` itself.
- `shiptrail init` commits the files it writes as "Add shiptrail setup".
- The backlog board follows each item's job, and the job log has a readable Transcript view.

## [0.1.0] - 2026-10-18

First release under the Shiptrail name. Shiptrail runs a configurable pipeline of Claude Code,
Codex and OpenCode agents against a repository, with a local dashboard.

- `shiptrail init` sets up any folder, detects the installed tools and writes the project's
  `shiptrail/` folder, starter instructions and in-chat shortcuts.
- The dashboard covers the command center, jobs, backlog, pipelines with a machine-wide
  library, activity, usage and repository settings.
- `shiptrail upgrade` keeps a repository's engine range and shortcuts in step with the
  installed engine.

## [0.1.0rc1] - 2026-10-18

Release candidate for 0.1.0; no `shiptrail upgrade` needed.
