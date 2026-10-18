import { useState } from "react";
import type { BacklogPriority, StartedBacklogItem } from "@/lib/api";
import { Badge } from "@/ui/primitives/badge";
import { Select } from "@/ui/primitives/select";
import { StatusBadge } from "@/ui/status";
import {
  backlogPriorities,
  boardColumns,
  priorityLabel,
  type BacklogItem,
  type BoardColumn,
} from "./model";

export function BacklogKanban({
  repo,
  backlog,
  started,
  jobs,
  busy,
  onPriority,
}: {
  repo: string;
  backlog: BacklogItem[];
  started: StartedBacklogItem[];
  jobs: { id: string; state: string }[];
  busy: boolean;
  onPriority: (item: BacklogItem, priority: BacklogPriority) => void;
}) {
  const [drag, setDrag] = useState<string>();
  const columns = boardColumns(backlog, started, jobs);
  return (
    <div
      className="flex gap-4 overflow-x-auto pb-3"
      tabIndex={0}
      aria-label="Backlog board columns"
    >
      {columns.map((column) => (
        <section
          key={column.id}
          aria-label={column.label}
          className="w-80 shrink-0 space-y-3 rounded-lg bg-inset p-3"
        >
          <h3 className="flex items-center justify-between text-sm font-medium">
            {column.label}
            <Badge>{column.count}</Badge>
          </h3>
          {column.groups ? (
            <ReadyGroups
              column={column}
              busy={busy}
              drag={drag}
              setDrag={setDrag}
              backlog={backlog}
              onPriority={onPriority}
            />
          ) : (
            <StartedCards column={column} repo={repo} />
          )}
        </section>
      ))}
    </div>
  );
}

function ReadyGroups({
  column,
  busy,
  drag,
  setDrag,
  backlog,
  onPriority,
}: {
  column: BoardColumn;
  busy: boolean;
  drag?: string;
  setDrag: (key?: string) => void;
  backlog: BacklogItem[];
  onPriority: (item: BacklogItem, priority: BacklogPriority) => void;
}) {
  return (
    <>
      {column.groups?.map((group) => (
        <div
          key={group.priority}
          role="group"
          aria-label={`${column.label}, ${group.label} priority`}
          className="space-y-2 rounded-md p-1"
          onDragOver={(e) => {
            if (drag && !busy) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const item = backlog.find((candidate) => candidate.key === drag);
            setDrag(undefined);
            if (item && !busy && item.priority !== group.priority) onPriority(item, group.priority);
          }}
        >
          <h4 className="text-xs font-medium text-muted-foreground">{group.label}</h4>
          {group.items.map((item) => (
            <article
              key={item.key}
              draggable={!busy}
              onDragStart={(e) => {
                setDrag(item.key);
                e.dataTransfer.setData("text/plain", item.key);
              }}
              onDragEnd={() => setDrag(undefined)}
              className="space-y-2 rounded-md bg-card p-3 shadow-[var(--shadow-border)]"
            >
              <h5 className="text-sm font-medium">{item.title}</h5>
              <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                {item.details}
              </p>
              <Select
                fieldSize="sm"
                aria-label={`Priority of ${item.title}`}
                disabled={busy}
                value={item.priority}
                onChange={(e) => onPriority(item, e.target.value as BacklogPriority)}
              >
                {backlogPriorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabel(priority)}
                  </option>
                ))}
              </Select>
            </article>
          ))}
          {!group.items.length && <p className="py-2 text-xs text-muted-foreground">No items</p>}
        </div>
      ))}
    </>
  );
}

function StartedCards({ column, repo }: { column: BoardColumn; repo: string }) {
  return (
    <div className="space-y-2">
      {column.started?.map((card) => (
        <article
          key={card.key}
          className="space-y-2 rounded-md bg-card p-3 shadow-[var(--shadow-border)]"
        >
          <h5 className="text-sm font-medium">{card.title}</h5>
          <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
            {card.details}
          </p>
          <div className="flex items-center justify-between gap-2">
            {card.state ? <StatusBadge state={card.state} /> : <span />}
            <a
              className="text-xs underline"
              href={`#/repo/${encodeURIComponent(repo)}/job/${encodeURIComponent(card.job)}`}
            >
              Open job
            </a>
          </div>
        </article>
      ))}
      {!column.started?.length && <p className="py-2 text-xs text-muted-foreground">No items</p>}
    </div>
  );
}
