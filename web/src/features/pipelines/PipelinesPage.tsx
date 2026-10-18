import { useState, type ReactNode } from "react";
import { GripVertical, Plus } from "lucide-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { api, keys, libraryApi, type configSchema, type overviewSchema } from "@/lib/api";
import { PipelineSettingsForm } from "@/features/settings/PipelineSettingsForm";
import {
  addPipeline,
  addPipelineSteps,
  canRemovePipeline,
  pipelineNameError,
  removePipeline,
  type Config,
} from "@/features/settings/model";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Select } from "@/ui/primitives/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { PageHeader } from "@/ui/page-header";
import { PageShell } from "@/ui/page-shell";

type Steps = z.infer<typeof configSchema>["pipelines"][string];

const executionCount = (steps: Steps) =>
  steps.reduce((n, step) => n + ("parallel" in step ? step.parallel.length : 1), 0);

function pipelineText(name: string, steps: Steps) {
  const stages = steps.length;
  const executions = executionCount(steps);
  return `${name} · ${stages} ${stages === 1 ? "stage" : "stages"}${
    executions > stages ? ` · ${executions} executions` : ""
  }`;
}

type Editing = { repo: string; pipeline: string };
/** An open New pipeline dialog: what to prefill. */
type Creating = { name: string; source?: string };

/** Drag payload carrying a library pipeline's name. */
const DRAG_TYPE = "application/x-shiptrail-pipeline";

/** Name a new pipeline and pick what it starts from: one of this repository's, or the library's. */
function NewPipelineDialog({
  config,
  initialName,
  initialSource,
  busy,
  error,
  onOpenChange,
  onCreate,
}: {
  config: Config;
  initialName: string;
  /** `repo:<name>` or `library:<name>`; defaults to the repository's default pipeline. */
  initialSource?: string;
  busy: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, next: Config) => void;
}) {
  const library = useQuery({ queryKey: ["library"], queryFn: libraryApi.list });
  const [name, setName] = useState(initialName);
  const [source, setSource] = useState(initialSource ?? `repo:${config.defaultPipeline}`);
  const nameError = name ? pipelineNameError(config, name) : undefined;
  function create() {
    if (!name || pipelineNameError(config, name)) return;
    const split = source.indexOf(":");
    const kind = source.slice(0, split);
    const from = source.slice(split + 1);
    const steps = library.data?.pipelines.find((p) => p.name === from)?.steps;
    onCreate(
      name,
      kind === "library" && steps
        ? addPipelineSteps(config, name, steps)
        : addPipeline(config, name, from),
    );
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New pipeline</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label>
            Name
            <Input
              autoFocus
              value={name}
              placeholder="e.g. docs-only"
              aria-invalid={nameError ? true : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {nameError && (
            <p role="alert" className="text-xs text-danger">
              {nameError}
            </p>
          )}
          <label>
            Start from
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              <optgroup label="This repository">
                {Object.keys(config.pipelines).map((p) => (
                  <option key={p} value={`repo:${p}`}>
                    {p}
                  </option>
                ))}
              </optgroup>
              {!!library.data?.pipelines.length && (
                <optgroup label="Library">
                  {library.data.pipelines.map((p) => (
                    <option key={p.name} value={`library:${p.name}`}>
                      {p.name}
                      {p.builtin ? " (built-in)" : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </label>
          <p className="text-xs text-muted-foreground">
            The new pipeline starts as a copy. You can change its steps next.
          </p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button loading={busy} disabled={!name || !!nameError || busy}>
              Create and edit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One repository's pipelines: choose the default, create, delete, and edit one in place. */
function RepoPipelines({
  repo,
  heading,
  config,
  editing,
  creating,
  onEdit,
  onCreating,
  editor,
}: {
  repo: { id: string; name: string };
  heading: string;
  config: Config;
  editing?: string;
  creating?: Creating;
  onEdit: (pipeline?: string) => void;
  onCreating: (next?: Creating) => void;
  /** The editor for `editing`, shown inside that pipeline's row. */
  editor: ReactNode;
}) {
  const client = useQueryClient();
  const [over, setOver] = useState(false);
  const save = useMutation({
    mutationFn: (next: Config) => api.saveConfig(repo.id, next),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.state(repo.id) }),
  });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={heading} className="text-sm font-medium">
          {repo.name}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={Plus}
          onClick={() => {
            save.reset();
            onCreating({ name: "" });
          }}
        >
          New pipeline
        </Button>
      </div>
      {save.error && !creating && (
        <p role="alert" className="text-sm text-danger">
          {save.error.message}
        </p>
      )}
      <ul
        aria-label={`${repo.name} pipelines`}
        className={`divide-y divide-border rounded-lg border ${
          over ? "border-dashed border-primary bg-secondary/40" : "border-border"
        }`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          const name = e.dataTransfer.getData(DRAG_TYPE);
          setOver(false);
          if (!name) return;
          e.preventDefault();
          save.reset();
          onCreating({ name, source: `library:${name}` });
        }}
      >
        {Object.entries(config.pipelines).map(([name, steps]) => {
          const isDefault = name === config.defaultPipeline;
          const open = editing === name;
          return (
            <li key={name} className={open ? "bg-secondary/30" : undefined}>
              <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className={open ? "font-medium" : undefined}>
                  {pipelineText(name, steps)}
                </span>
                {isDefault && <Badge variant="outline">default</Badge>}
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant={open ? "outline" : "ghost"}
                    size="sm"
                    aria-label={`${open ? "Close" : "Edit"} pipeline ${name}`}
                    aria-expanded={open}
                    onClick={() => onEdit(open ? undefined : name)}
                  >
                    {open ? "Close" : "Edit"}
                  </Button>
                  {!isDefault && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Make ${name} the default pipeline`}
                      disabled={save.isPending}
                      onClick={() => save.mutate({ ...config, defaultPipeline: name })}
                    >
                      Set as default
                    </Button>
                  )}
                  {canRemovePipeline(config, name) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete pipeline ${name}`}
                      disabled={save.isPending}
                      onClick={() => {
                        if (!window.confirm(`Delete the ${name} pipeline from ${repo.name}?`))
                          return;
                        if (open) onEdit(undefined);
                        save.mutate(removePipeline(config, name));
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </span>
              </div>
              {open && <div className="border-t border-border p-3">{editor}</div>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Drag a pipeline from the library onto this list to add a copy.
      </p>
      {creating && (
        <NewPipelineDialog
          key={`${creating.source}:${creating.name}`}
          config={config}
          initialName={creating.name}
          initialSource={creating.source}
          busy={save.isPending}
          error={save.error?.message}
          onOpenChange={(open) => !open && onCreating(undefined)}
          onCreate={(name, next) =>
            save.mutate(next, {
              onSuccess: () => {
                onCreating(undefined);
                onEdit(name);
              },
            })
          }
        />
      )}
    </>
  );
}

export function PipelinesPage({ repos }: z.infer<typeof overviewSchema>) {
  const [editing, setEditing] = useState<Editing>();
  const [creating, setCreating] = useState<Creating & { repo: string }>();
  const usable = repos.filter((repo) => repo.status === "available");
  const client = useQueryClient();
  const library = useQuery({ queryKey: ["library"], queryFn: libraryApi.list });
  const remove = useMutation({
    mutationFn: libraryApi.remove,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["library"] }),
  });
  const states = useQueries({
    queries: repos.map((repo) => ({
      queryKey: keys.state(repo.id),
      queryFn: () => api.state(repo.id),
      enabled: repo.status === "available",
    })),
  });
  return (
    <PageShell gap="loose">
      <PageHeader
        title="Pipelines"
        description="Configured pipelines for every registered repository."
      />
      <section aria-labelledby="pipeline-library" className="space-y-3">
        <h2 id="pipeline-library" className="text-sm font-medium">
          Library
        </h2>
        <p className="text-xs text-muted-foreground">
          Pipelines saved on this machine. Drag one onto a repository, or use Add to, to copy it
          into that repository&apos;s config, so it keeps working for anyone who clones it.
        </p>
        {library.error && (
          <p role="alert" className="text-sm">
            Could not load the library: {library.error.message}
          </p>
        )}
        {remove.error && (
          <p role="alert" className="text-sm text-danger">
            {remove.error.message}
          </p>
        )}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {library.data?.pipelines.map((item) => (
            <li
              key={item.name}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, item.name);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="flex cursor-grab flex-wrap items-center gap-3 p-3 text-sm active:cursor-grabbing"
            >
              <GripVertical aria-hidden className="size-4 text-muted-foreground" />
              <span>{pipelineText(item.name, item.steps as Steps)}</span>
              {item.builtin && <Badge variant="outline">built-in</Badge>}
              <span className="ml-auto flex flex-wrap items-center gap-1">
                {!!usable.length && (
                  <Select
                    aria-label={`Add ${item.name} to a repository`}
                    className="h-8 w-auto text-xs"
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        setCreating({
                          repo: e.target.value,
                          name: item.name,
                          source: `library:${item.name}`,
                        });
                    }}
                  >
                    <option value="">Add to…</option>
                    {usable.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.name}
                      </option>
                    ))}
                  </Select>
                )}
                {!item.builtin && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete library pipeline ${item.name}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(item.name)}
                  >
                    Delete
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {!repos.length && (
        <p className="text-sm text-muted-foreground">
          No repositories registered. Run shiptrail init in a project to get started.
        </p>
      )}
      {repos.map((repo, index) => {
        const query = states[index];
        const heading = `pipelines-${repo.id}`;
        return (
          <section key={repo.id} aria-labelledby={heading} className="space-y-3">
            {repo.status !== "available" ? (
              <>
                <h2 id={heading} className="text-sm font-medium">
                  {repo.name}
                </h2>
                <p className="text-sm text-warn-fg">
                  {repo.status === "missing" ? "Repository missing" : "Upgrade required"}
                  {repo.detail ? ` · ${repo.detail}` : ""}
                </p>
              </>
            ) : query.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading pipelines…
              </p>
            ) : query.isError ? (
              <p role="alert" className="text-sm">
                Could not load pipelines: {query.error.message}
              </p>
            ) : (
              <RepoPipelines
                repo={repo}
                heading={heading}
                config={query.data.config}
                editing={editing?.repo === repo.id ? editing.pipeline : undefined}
                creating={creating?.repo === repo.id ? creating : undefined}
                onEdit={(pipeline) =>
                  setEditing(pipeline ? { repo: repo.id, pipeline } : undefined)
                }
                onCreating={(next) => setCreating(next ? { ...next, repo: repo.id } : undefined)}
                editor={
                  editing?.repo === repo.id && (
                    <PipelineSettingsForm
                      key={`${editing.repo}:${editing.pipeline}`}
                      repo={repo.id}
                      initialPipeline={editing.pipeline}
                      single
                      onClose={() => setEditing(undefined)}
                    />
                  )
                }
              />
            )}
          </section>
        );
      })}
    </PageShell>
  );
}
