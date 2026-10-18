import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, FilePen, Info, Loader2, Terminal, Wrench, X } from "lucide-react";
import { Button } from "@/ui/primitives/button";
import { cn } from "@/ui/utils";
import type { LogEntry } from "./log-lines";
import { buildTranscript, type BlockState, type TranscriptBlock } from "./transcript-blocks";

function StateMark({ state, exitCode }: { state: BlockState; exitCode?: number | null }) {
  if (state === "running")
    return (
      <Loader2
        aria-label="Running"
        className="size-3.5 shrink-0 animate-spin text-muted-foreground"
      />
    );
  if (state === "failed")
    return (
      <span className="flex shrink-0 items-center gap-1 text-danger">
        <X aria-label="Failed" className="size-3.5" />
        {exitCode ? <span className="text-xs">exit {exitCode}</span> : null}
      </span>
    );
  return <Check aria-label="Done" className="size-3.5 shrink-0 text-online" />;
}

/** A row that opens to show more. Its body is only built while open, so long output stays cheap. */
function Row({
  icon,
  title,
  detail,
  state,
  exitCode,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** Left out for rows that are not an action with an outcome. */
  state?: BlockState;
  exitCode?: number | null;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expandable = !!children;
  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs disabled:cursor-default"
      >
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className={cn("font-mono", detail ? "shrink-0" : "min-w-0 flex-1 truncate")}>
          {title}
        </span>
        {detail && <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail}</span>}
        {state && <StateMark state={state} exitCode={exitCode} />}
        {expandable && (
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && expandable && <div className="space-y-2 border-t border-border p-3">{children}</div>}
    </div>
  );
}

function Pre({ label, text }: { label?: string; text: string }) {
  return (
    <div>
      {label && (
        <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      )}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-2 font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}

function shortPath(path: string) {
  // Worktree paths are long and the same for every file: keep the part that tells files apart.
  const parts = path.split(/[\\/]/);
  const at = parts.findIndex((part) => /^\d+-/.test(part));
  return at >= 0 ? parts.slice(at + 1).join("/") : parts.slice(-3).join("/");
}

function Block({ block, multi }: { block: TranscriptBlock; multi: boolean }) {
  switch (block.kind) {
    case "message":
      return (
        <div className="space-y-1">
          {multi && (
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {block.stage}/{block.agent}
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{block.text}</p>
        </div>
      );
    case "thinking":
      return (
        <p className="whitespace-pre-wrap text-xs italic text-muted-foreground">{block.text}</p>
      );
    case "command":
      return (
        <Row
          icon={<Terminal className="size-3.5" />}
          title={block.summary}
          state={block.state}
          exitCode={block.exitCode}
        >
          <Pre label="Command" text={block.script} />
          {block.output && <Pre label="Output" text={block.output} />}
        </Row>
      );
    case "tool":
      return (
        <Row
          icon={<Wrench className="size-3.5" />}
          title={`${block.server} · ${block.tool}`}
          detail={block.args}
          state={block.state}
        >
          {block.args && <Pre label="Arguments" text={block.args} />}
          {block.result && <Pre label="Result" text={block.result} />}
        </Row>
      );
    case "files":
      return (
        <Row
          icon={<FilePen className="size-3.5" />}
          title={`${block.changes.length} ${block.changes.length === 1 ? "file" : "files"} changed`}
          state={block.state}
        >
          <ul className="space-y-0.5 font-mono text-xs">
            {block.changes.map((change) => (
              <li key={change.path}>
                <span className="text-muted-foreground">{change.kind}</span>{" "}
                {shortPath(change.path)}
              </li>
            ))}
          </ul>
        </Row>
      );
    case "note":
      if (block.text.length > 240 || block.text.includes("\n"))
        return (
          <Row
            icon={<Info className="size-3.5" />}
            title={block.text.split(/\r?\n/)[0].slice(0, 120)}
            detail={`${block.text.length} characters`}
          >
            <Pre text={block.text} />
          </Row>
        );
      return (
        <p
          className={cn(
            "whitespace-pre-wrap font-mono text-xs",
            block.error ? "text-danger" : "text-muted-foreground",
          )}
        >
          {block.text}
        </p>
      );
  }
}

const height = 560;

/** The agent's work as a conversation: what it said, what it ran, and what came back. */
export function Transcript({ entries, multi }: { entries: LogEntry[]; multi: boolean }) {
  const blocks = useMemo(() => buildTranscript(entries), [entries]);
  const [following, setFollowing] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (following && el) el.scrollTop = el.scrollHeight;
  }, [blocks, following]);
  return (
    <div className="space-y-2">
      <div
        ref={box}
        tabIndex={0}
        aria-label="Agent transcript"
        className="space-y-3 overflow-y-auto overflow-x-hidden rounded bg-inset p-3"
        style={{ height }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollowing(el.scrollHeight - el.clientHeight - el.scrollTop < 24);
        }}
      >
        {!blocks.length && <p className="text-sm text-muted-foreground">Waiting for the agent…</p>}
        {blocks.map((block) => (
          <Block key={block.key} block={block} multi={multi} />
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <p>{following ? `${blocks.length} steps · following` : "Auto-scroll paused"}</p>
        {!following && (
          <Button
            variant="outline"
            onClick={() => {
              setFollowing(true);
            }}
          >
            Resume auto-scroll
          </Button>
        )}
      </div>
    </div>
  );
}
