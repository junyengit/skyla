import { describe, expect, it } from "vitest";

import { initialFramesFor } from "./components/sky-journey";

describe("journey frame loading", () => {
  it("limits the initial queue to the retained bitmap cache", () => {
    const frames = initialFramesFor(600, 240);

    expect(frames).toHaveLength(240);
    expect(new Set(frames).size).toBe(240);
    expect(frames).toContain(0);
    expect(frames).toContain(599);
  });

  it("queues every frame when the sequence fits in the cache", () => {
    expect(initialFramesFor(4, 240).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
});
