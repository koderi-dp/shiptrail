import { afterEach, describe, expect, it, vi } from "vitest";
import { whileVisible } from "./sse";

function fakeDocument(state: "visible" | "hidden") {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: state,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    set(next: "visible" | "hidden") {
      doc.visibilityState = next;
      for (const fn of [...listeners]) fn();
    },
    listeners,
  };
  vi.stubGlobal("document", doc);
  return doc;
}

describe("whileVisible", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("holds a connection only while the tab is visible", () => {
    const doc = fakeDocument("visible");
    let open = 0;
    const stop = whileVisible(() => {
      open += 1;
      return () => {
        open -= 1;
      };
    });
    expect(open).toBe(1);
    doc.set("hidden");
    expect(open).toBe(0);
    doc.set("hidden");
    expect(open).toBe(0);
    doc.set("visible");
    doc.set("visible");
    expect(open).toBe(1);
    stop();
    expect(open).toBe(0);
    expect(doc.listeners.size).toBe(0);
  });

  it("does not connect at all while the tab starts hidden, and connects when shown", () => {
    const doc = fakeDocument("hidden");
    const start = vi.fn(() => () => undefined);
    const stop = whileVisible(start);
    expect(start).not.toHaveBeenCalled();
    doc.set("visible");
    expect(start).toHaveBeenCalledTimes(1);
    stop();
  });
});
