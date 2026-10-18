---
name: shiptrail
description: Start and manage shiptrail jobs in this repository.
---

Use the installed `shiptrail` command.
If it is missing, tell the user to run `uv tool install shiptrail` and stop.

Map the user's request to one command:
- A feature description: `shiptrail start "<feature>"`.
- next: `shiptrail next`.
- status: `shiptrail status` (optionally a job id).
- approve: `shiptrail approve <id>`.
- rework: `shiptrail rework <id> "<note>"`.
- stop: `shiptrail stop <id>`.
- resume: `shiptrail resume <id>`.
- dashboard: `shiptrail dashboard`.

Pass `--pipeline fast|full` when the user chooses a pipeline.
Run the command and relay its job id, dashboard link, or error.
The service runs the job; it keeps running when this session closes.
The dashboard Start button also runs jobs directly.
Do not orchestrate steps or launch agents yourself.
