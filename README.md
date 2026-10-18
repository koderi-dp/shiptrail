# Shiptrail

Shiptrail runs a configurable pipeline of Claude Code, Codex, and OpenCode agents against
your repository. Each job gets its own branch and worktree. The engine stores job state, streams
logs to a local dashboard, and either merges a verified result or pauses with a clear request
for you.

## Requirements

- Python 3.11+ and [uv](https://docs.astral.sh/uv/getting-started/installation/).
- Git. A new folder is set up by `shiptrail init`; an existing repository can use any branch.
- Claude Code, Codex, or OpenCode CLI, signed in. Install the client you select in the pipeline.
- Optional: [agent-browser](https://github.com/vercel-labs/agent-browser) for browser checks:
  `npm install -g agent-browser && agent-browser install`. `shiptrail doctor` reports it but does
  not require it.

## Install

Install the engine once per machine:

```bash
uv tool install shiptrail
```

Release candidate, from TestPyPI, until the stable release is published:

```bash
uv tool install --default-index https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ shiptrail
```

If uv is not installed, `install.py` is an optional bootstrap. It prints uv's official
installation instructions and asks before running the official installer, then installs the
engine:

```powershell
python install.py
```

Pass `--target path/to/your-project` to also run `shiptrail init` in that folder.

## Quick start

Start from any folder, empty or not:

```bash
cd path/to/your-project
shiptrail init
shiptrail doctor
shiptrail start "build a todo app"
```

`shiptrail init` looks for Claude Code, Codex and OpenCode on your machine, shows the plan, and
asks once before it changes anything. With one usable tool it uses that tool without asking.
With several it asks which one the pipeline should start on (Enter takes the first):

```text
Found Claude Code, Codex and OpenCode.
Which tool should the pipeline use by default?
  1) Claude Code
  2) Codex
  3) OpenCode
  4) Mixed: the template's choice for each stage
You can change any stage later on the Pipelines page. [1]:
Plan for C:\path\to\your-project:
  would create: git repository on main
  would write: AGENTS.md (starter; edit the TODO lines)
  would write: CLAUDE.md (imports AGENTS.md for Claude Code)
  would commit: AGENTS.md, CLAUDE.md as the first commit on main
  would write: .shiptrail/config.json
  would write: .shiptrail/backlog.md
  would write: .claude/skills/shiptrail/SKILL.md
  would write: .agents/skills/shiptrail/SKILL.md
  would write: .opencode/skills/shiptrail/SKILL.md
  would update: .gitignore
  would commit: .shiptrail/config.json, .shiptrail/backlog.md, .claude/skills/shiptrail/SKILL.md, .agents/skills/shiptrail/SKILL.md, .opencode/skills/shiptrail/SKILL.md, .gitignore as "Add shiptrail setup"
Continue? [Y/n]
```

The answer sets the tool every stage starts on; each stage can use a different tool afterwards, on
the Pipelines page. "Mixed" keeps the template's tool for each stage and moves a stage to your
first tool when its own is not installed. `init` installs the in-chat shortcut (`/shiptrail` or
`$shiptrail`) for every tool it found. If none is installed it stops and says how to install one;
`--provider claude|codex|opencode|both` skips detection, for scripts.

What init does:

- **No git repository:** creates one on `main` and makes a first commit with the starter
  instructions file. If git has no name or email configured, it stops and prints the two
  `git config` commands to run.
- **Existing repository:** uses its current branch as the base branch and records it in
  `.shiptrail/config.json`. Nothing is renamed.
- **No `AGENTS.md` or `CLAUDE.md`:** writes a starter with `TODO` lines. With Claude Code alone that is
  `CLAUDE.md`. When other tools share the project it is `AGENTS.md`, plus a `CLAUDE.md` that imports
  it, so every tool reads the same instructions. Edit them to describe
  your install, dev server and checks. If the folder has a `package.json` with `dev`, `test`,
  `build` or `lint` scripts, those commands are filled in.

`init` finishes by committing the files it wrote (the starter instructions, `.shiptrail/`, the skill
wrappers and `.gitignore`) as "Add shiptrail setup", and nothing else. A job's working folder is
made from the committed base branch, so this is what gives the agent your `AGENTS.md`, and it keeps
those files from blocking the merge later. If `.gitignore` already had unfinished edits, `init`
leaves it uncommitted and says so; if git has no name or email, it says that instead of
committing. The engine never pushes to a remote.

Run `shiptrail --help` for the commands, or `shiptrail <command> --help` for one of them.

## Use it

Start work with the skill command from your client:

```text
/shiptrail Add a dark mode toggle to settings     (Claude Code)
$shiptrail Add a dark mode toggle to settings     (Codex)
```

Other commands:

| Command | What it does |
|---|---|
| `shiptrail start "<title>"` | Queue a job from the title |
| `shiptrail status` | List jobs and any that need you |
| `shiptrail approve <job-id>` | Approve a finished job and merge it into the base branch |
| `shiptrail rework <job-id> "<note>"` | Send a job back to the builder with a note |
| `shiptrail resume <job-id>` / `shiptrail stop <job-id>` | Resume or stop a job |
| `shiptrail delete <job-id>` | Delete a job, its worktree and its branch |
| `shiptrail doctor` | Check tools, logins and ports, with a fix for each problem |
| `shiptrail dashboard` | Open this repository's dashboard |

You can also add work to `.shiptrail/backlog.md` or the dashboard backlog, then start it with
`shiptrail next`.

## Define your pipeline

Edit the pipelines in `.shiptrail/config.json` or use Dashboard Settings. Full runs a spec,
builder, parallel reviewers, and approval. Fast uses the shorter implementation and approval
flow. Configure roles, providers, model and effort per execution, retry limits, and merge
policy. Jobs retain a snapshot of their pipeline and role instructions, so later settings
changes affect new jobs only.

In the pipeline editor, Role, Model and Effort are dropdowns. Roles are the built-in ones plus any in
`.shiptrail/roles/`. Models and efforts are read from your installed tools, `codex debug models` and
`opencode models`, which only list metadata and never call a model. The answers are cached for ten
minutes. Claude Code has no such command, so it offers its aliases. If a tool is missing or does not
answer, the dropdown falls back to built-in choices and says why. "Custom..." accepts any other value.
A saved model that is not in a tool's list is kept and flagged.

## When a job needs you

Jobs pause when an agent is blocked, a review requests changes beyond the retry limit, the
approver escalates a product or risk decision, or the merge policy requires your review.
`shiptrail status` and the dashboard show the reason and the reports to inspect. Resolve the
request in the branch, then resume or rework the job. The engine never pushes to a remote.

## The dashboard

Run `shiptrail dashboard` to open the dashboard for this repository, or `shiptrail serve --open` to
start the service and open it. By default the URL is `http://127.0.0.1:5099/`. The dashboard shows
jobs across registered repositories, pipeline steps, reports, timeline, logs and usage. It also
supports backlog management, repository and machine settings, and job actions such as stop,
resume, approve, rework and delete. The service listens on localhost only.

## What a job leaves behind

The repository keeps its configuration and backlog in the hidden `.shiptrail/` folder. `.shiptrail/backlog.md` keeps
its plain line format; each item's priority and pipeline are kept beside it in the sidecar
`.shiptrail/backlog.meta.json`, which may be deleted safely (items fall back to normal priority
and the default pipeline). The board's columns are not stored: they come from the state of each
item's job. Job state, reports,
attempt logs and archived outputs live under `.shiptrail/jobs/<job-id>/`; worktrees are kept
beside the repository until merged or deleted. The exact report set depends on the pipeline.
The machine registry and service state live in the user data directory (or `SHIPTRAIL_HOME`).

## Customising

Built-in roles ship with the engine. To customize a role for one repository, run
`shiptrail eject <role>` and edit the resulting file in `.shiptrail/roles/`. The dashboard Settings
page edits pipeline configuration; machine settings control provider executable paths
(`cli.claude`, `cli.codex`, `cli.opencode`), concurrency and available ports. Ejected roles
remain repository-local and can be compared with the built-in version using
`shiptrail eject <role> --diff`.

## Working on this repo

Set up the development environment with `uv sync --locked`. The Python suite runs with
`uv run --locked pytest`, or in parallel with `uv run --locked pytest -n 4` (about a minute, against
about six serially). Tests that touch the fixed sandbox port range are kept on one worker.

The dashboard lives in `web/`: run `npm ci`, then `npm run build` to rebuild the bundle the
engine serves, and `npm run typecheck`, `npm run lint`, `npm test` and `npm run e2e` to check it.

## License

See [LICENSE](LICENSE).
