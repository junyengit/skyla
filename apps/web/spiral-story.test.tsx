import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpiralStaircaseStory } from "./components/spiral-story";

describe("Sky LA spiral story", () => {
  it("keeps the complete story visible in the server-rendered static layout", () => {
    const html = renderToStaticMarkup(<SpiralStaircaseStory />);

    expect(html).toContain('data-scroll-mode="static"');
    expect(html).toContain("The view keeps building.");
    expect(html).toContain("the staircase builds with you");
    expect(html).toContain("Century City");
    expect(html).toContain("360°");
    expect(html).toContain("Museum Row");
    expect(html).toContain("The glass lounge");
    expect(html).toContain("Deck + lounge");
    expect(html).toContain("Hollywood Hills");
    expect(html).toContain("Timed entry");
  });
});
