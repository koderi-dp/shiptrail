import type { BacklogPriority, StartedBacklogItem } from "@/lib/api";

export const backlogPriorities: readonly BacklogPriority[] = ["high", "normal", "low"];

const priorityLabels: Record<BacklogPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const priorityLabel = (priority: BacklogPriority) => priorityLabels[priority];

export type BacklogItem = {
  index: number;
  key: string;
  title: string;
  details: string;
  priority: BacklogPriority;
  pipeline?: string | null;
};

/** Board columns. Where an item sits is decided by its job, never set by hand. */
export type BoardColumnId = "ready" | "in_progress" | "needs_input" | "completed";

export const boardColumnLabels: Record<BoardColumnId, string> = {
  ready: "Ready",
  in_progress: "In progress",
  needs_input: "Needs input",
  completed: "Completed",
};

/** The column of a started item, from the state of its job. */
export function columnForJob(state: string | undefined): BoardColumnId {
  switch (state) {
    case "paused":
    case "needs_human":
      return "needs_input";
    case "merged":
    case "cancelled":
      return "completed";
    default:
      return "in_progress";
  }
}

export type StartedCard = StartedBacklogItem & { state: string | undefined };

export type BoardColumn = {
  id: BoardColumnId;
  label: string;
  count: number;
  /** Ready only: waiting items, grouped by priority. */
  groups?: { priority: BacklogPriority; label: string; items: BacklogItem[] }[];
  /** Every other column: started items, with the state of their job. */
  started?: StartedCard[];
};

export function boardColumns(
  backlog: readonly BacklogItem[],
  started: readonly StartedBacklogItem[],
  jobs: readonly { id: string; state: string }[],
): BoardColumn[] {
  const ordered = [...backlog].sort((a, b) => a.index - b.index);
  const states = new Map(jobs.map((job) => [job.id, job.state]));
  const cards = started.map((item) => ({ ...item, state: states.get(item.job) }));
  return [
    {
      id: "ready",
      label: boardColumnLabels.ready,
      count: ordered.length,
      groups: backlogPriorities.map((priority) => ({
        priority,
        label: priorityLabel(priority),
        items: ordered.filter((item) => item.priority === priority),
      })),
    },
    ...(["in_progress", "needs_input", "completed"] as const).map((id) => {
      const inColumn = cards.filter((card) => columnForJob(card.state) === id);
      return { id, label: boardColumnLabels[id], count: inColumn.length, started: inColumn };
    }),
  ];
}
