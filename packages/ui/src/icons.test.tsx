import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArrowRight, CalendarDays, Download, MapPin, ShieldCheck, Sparkles } from "./icons";

const icons = [ArrowRight, CalendarDays, Download, MapPin, ShieldCheck, Sparkles];

describe("shared icons", () => {
  it.each(icons)("renders an accessible, current-color SVG", (Icon) => {
    const markup = renderToStaticMarkup(<Icon className="fixture" size={24} />);

    expect(markup).toContain("<svg");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('class="fixture"');
    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('stroke="currentColor"');
  });
});
