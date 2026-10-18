import { describe, expect, it } from "vitest";
import type { LogEntry } from "./log-lines";
import { buildTranscript, commandScript, commandSummary } from "./transcript-blocks";

const wrapped =
  "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command '$ErrorActionPreference='\"'Stop'; git branch --show-current; Get-Content -Raw -LiteralPath 'AGENTS.md'\"";

const entry = (n: number, event: unknown): LogEntry => ({
  key: `k${n}`,
  stage: "build",
  agent: "build",
  line: typeof event === "string" ? event : JSON.stringify(event),
});

describe("transcript", () => {
  it("shows the script inside the PowerShell wrapper, on one line", () => {
    expect(commandScript(wrapped)).toBe(
      "git branch --show-current; Get-Content -Raw -LiteralPath 'AGENTS.md'",
    );
    expect(commandScript("npm test")).toBe("npm test");
    expect(commandSummary("first line\nsecond")).toBe("first line");
    expect(commandSummary("x".repeat(300))).toHaveLength(120);
  });

  it("merges a started item with its completion and keeps order", () => {
    const blocks = buildTranscript([
      entry(1, { type: "thread.started", thread_id: "t" }),
      entry(2, {
        type: "item.completed",
        item: { id: "i0", type: "agent_message", text: "Hello" },
      }),
      entry(3, {
        type: "item.started",
        item: {
          id: "i1",
          type: "command_execution",
          command: wrapped,
          aggregated_output: "",
          status: "in_progress",
        },
      }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["message", "command"]);
    expect(blocks[1]).toMatchObject({ kind: "command", state: "running", exitCode: null });
    const finished = buildTranscript([
      entry(2, {
        type: "item.completed",
        item: { id: "i0", type: "agent_message", text: "Hello" },
      }),
      entry(3, {
        type: "item.started",
        item: {
          id: "i1",
          type: "command_execution",
          command: wrapped,
          aggregated_output: "",
          status: "in_progress",
        },
      }),
      entry(4, {
        type: "item.completed",
        item: {
          id: "i1",
          type: "command_execution",
          command: wrapped,
          aggregated_output: "main\n",
          exit_code: 1,
          status: "failed",
        },
      }),
    ]);
    expect(finished).toHaveLength(2);
    expect(finished[1]).toMatchObject({
      kind: "command",
      state: "failed",
      exitCode: 1,
      output: "main\n",
      key: "k3",
    });
  });

  it("describes tool calls, file changes and plain lines", () => {
    const blocks = buildTranscript([
      entry(1, {
        type: "item.completed",
        item: {
          id: "i2",
          type: "mcp_tool_call",
          server: "context7",
          tool: "resolve-library-id",
          arguments: { libraryName: "Express" },
          result: { content: [{ type: "text", text: "Available Libraries" }] },
          status: "completed",
        },
      }),
      entry(2, {
        type: "item.completed",
        item: {
          id: "i3",
          type: "file_change",
          changes: [{ path: "a.ts", kind: "update" }],
          status: "completed",
        },
      }),
      entry(3, "warning: something on stderr"),
      entry(4, { type: "turn.failed", error: { message: "boom" } }),
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "tool",
      args: "libraryName: Express",
      result: "Available Libraries",
    });
    expect(blocks[1]).toMatchObject({ kind: "files", changes: [{ path: "a.ts", kind: "update" }] });
    expect(blocks[2]).toMatchObject({ kind: "note", error: false });
    expect(blocks[3]).toMatchObject({ kind: "note", error: true, text: "boom" });
  });

  it("starts a new block when a finished item's id is reused", () => {
    const run = (n: number, output: string) => [
      entry(n, {
        type: "item.started",
        item: { id: "i1", type: "command_execution", command: "a" },
      }),
      entry(n + 1, {
        type: "item.completed",
        item: {
          id: "i1",
          type: "command_execution",
          command: "a",
          aggregated_output: output,
          exit_code: 0,
        },
      }),
    ];
    expect(
      buildTranscript([...run(1, "one"), ...run(3, "two")]).map((b) => "output" in b && b.output),
    ).toEqual(["one", "two"]);
  });
});
