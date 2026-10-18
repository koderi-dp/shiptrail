import { describe, expect, it } from "vitest";
import { boardColumns, columnForJob } from "./model";

describe("backlog board", () => {
  it("places a started item by the state of its job", () => {
    expect(
      (["queued", "running", "approved"] as const).map((state) => columnForJob(state)),
    ).toEqual(["in_progress", "in_progress", "in_progress"]);
    expect(columnForJob("needs_human")).toBe("needs_input");
    expect(columnForJob("paused")).toBe("needs_input");
    expect(columnForJob("merged")).toBe("completed");
    expect(columnForJob("cancelled")).toBe("completed");
    expect(columnForJob(undefined)).toBe("in_progress");
  });

  it("lists waiting items by priority and started items by job", () => {
    const columns = boardColumns(
      [
        { index: 0, key: "a", title: "A", details: "", priority: "low" },
        { index: 1, key: "b", title: "B", details: "", priority: "high" },
      ],
      [
        { key: "c", title: "C", details: "", job: "001-c" },
        { key: "d", title: "D", details: "", job: "002-d" },
        { key: "e", title: "E", details: "", job: "003-e" },
      ],
      [
        { id: "001-c", state: "running" },
        { id: "002-d", state: "needs_human" },
        { id: "003-e", state: "merged" },
      ],
    );
    expect(columns.map((c) => [c.id, c.count])).toEqual([
      ["ready", 2],
      ["in_progress", 1],
      ["needs_input", 1],
      ["completed", 1],
    ]);
    expect(columns[0].groups?.map((g) => g.items.map((i) => i.key))).toEqual([["b"], [], ["a"]]);
    expect(columns[2].started?.[0]).toMatchObject({ key: "d", state: "needs_human" });
  });
});
