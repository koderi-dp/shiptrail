import type { LogEntry } from "./log-lines";

export type BlockState = "running" | "done" | "failed";

type Origin = { key: string; stage: string; agent: string };

export type TranscriptBlock = Origin &
  (
    | { kind: "message"; text: string }
    | { kind: "thinking"; text: string }
    | {
        kind: "command";
        summary: string;
        script: string;
        output: string;
        state: BlockState;
        exitCode: number | null;
      }
    | {
        kind: "tool";
        server: string;
        tool: string;
        args: string;
        result: string;
        state: BlockState;
      }
    | { kind: "files"; changes: { path: string; kind: string }[]; state: BlockState }
    | { kind: "note"; text: string; error: boolean }
  );

type Item = Record<string, unknown> & { id?: string; type?: string };

const SUMMARY_LENGTH = 120;

/** The script inside a `pwsh -Command '...'` wrapper; the whole command when it is not one. */
export function commandScript(command: string): string {
  const wrapped = /^"[^"]*\\(?:pwsh|powershell)(?:\.exe)?"\s+-Command\s+([\s\S]*)$/i.exec(command);
  if (!wrapped) return command;
  const body = wrapped[1].trim();
  // Codex writes `'$ErrorActionPreference='"'Stop'; <script>"`, or just `'<script>'`.
  const script =
    /^'\$ErrorActionPreference='"'Stop';\s*([\s\S]*)"$/i.exec(body)?.[1] ??
    /^'([\s\S]*)'$/.exec(body)?.[1] ??
    body;
  return script.trim() || command;
}

/** A one-line description of a command, for the collapsed row. */
export function commandSummary(script: string): string {
  const line = script.split(/\r?\n/).find((l) => l.trim()) ?? script;
  const flat = line.trim();
  return flat.length > SUMMARY_LENGTH ? `${flat.slice(0, SUMMARY_LENGTH - 1)}…` : flat;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolResult(item: Item): string {
  const result = item.result as { content?: { text?: unknown }[] } | null | undefined;
  const parts = result?.content?.map((c) => textOf(c.text)).filter(Boolean);
  const error = item.error as { message?: unknown } | string | null | undefined;
  if (parts?.length) return parts.join("\n");
  if (error) return typeof error === "string" ? error : textOf(error.message ?? error);
  return "";
}

function argsSummary(args: unknown): string {
  if (!args || typeof args !== "object") return textOf(args);
  return Object.entries(args as Record<string, unknown>)
    .map(([name, value]) => `${name}: ${typeof value === "string" ? value : textOf(value)}`)
    .join(" · ");
}

function stateOf(item: Item, done: boolean): BlockState {
  if (item.status === "failed") return "failed";
  return done ? "done" : "running";
}

/**
 * Turns the agent's event lines into a conversation: a started item and its completion
 * become one block that changes as the work finishes. Lines that are not events stay as notes.
 */
export function buildTranscript(entries: readonly LogEntry[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  // Where each item's block is, while it is still open; a finished item may reuse its id.
  const open = new Map<string, number>();
  for (const entry of entries) {
    const origin: Origin = { key: entry.key, stage: entry.stage, agent: entry.agent };
    let event: { type?: string; item?: Item; message?: unknown; error?: unknown } | null;
    try {
      event = JSON.parse(entry.line);
    } catch {
      event = null;
    }
    if (!event || typeof event !== "object") {
      if (entry.line.trim())
        blocks.push({ ...origin, kind: "note", text: entry.line, error: false });
      continue;
    }
    if (event.type === "error" || event.type === "turn.failed") {
      const detail = textOf(event.message ?? (event.error as { message?: unknown })?.message);
      blocks.push({ ...origin, kind: "note", text: detail || event.type, error: true });
      continue;
    }
    const item = event.item;
    if (!item || (event.type !== "item.started" && event.type !== "item.completed")) continue;
    const done = event.type === "item.completed";
    const slot = `${entry.stage}/${entry.agent}/${item.id ?? entry.key}`;
    let block: TranscriptBlock | undefined;
    switch (item.type) {
      case "agent_message":
        block = { ...origin, kind: "message", text: textOf(item.text) };
        break;
      case "reasoning":
        block = { ...origin, kind: "thinking", text: textOf(item.text) };
        break;
      case "command_execution": {
        const script = commandScript(textOf(item.command));
        block = {
          ...origin,
          kind: "command",
          summary: commandSummary(script),
          script,
          output: textOf(item.aggregated_output),
          state: stateOf(item, done),
          exitCode: typeof item.exit_code === "number" ? item.exit_code : null,
        };
        break;
      }
      case "mcp_tool_call":
        block = {
          ...origin,
          kind: "tool",
          server: textOf(item.server),
          tool: textOf(item.tool),
          args: argsSummary(item.arguments),
          result: toolResult(item),
          state: stateOf(item, done),
        };
        break;
      case "file_change":
        block = {
          ...origin,
          kind: "files",
          changes: ((item.changes as { path?: unknown; kind?: unknown }[] | undefined) ?? []).map(
            (c) => ({ path: textOf(c.path), kind: textOf(c.kind) }),
          ),
          state: stateOf(item, done),
        };
        break;
      default:
        continue;
    }
    const at = open.get(slot);
    if (at !== undefined) blocks[at] = { ...block, key: blocks[at].key };
    else blocks.push(block);
    if (done) open.delete(slot);
    else if (at === undefined) open.set(slot, blocks.length - 1);
  }
  return blocks;
}
