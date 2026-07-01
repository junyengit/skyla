import { describe, expect, it } from "vitest";

import { authorizeTerminalReaderSelection, parseTerminalReaderRegistry } from "./lib/terminalReaderRegistry";

describe("Terminal reader registry helpers", () => {
  it("authorizes a reader and fills the server-configured location", () => {
    expect(
      authorizeTerminalReaderSelection(
        { readerId: "tmr_front_desk" },
        "tmr_front_desk@tml_lobby,tmr_bar@tml_rooftop"
      )
    ).toEqual({
      readerId: "tmr_front_desk",
      terminalLocationId: "tml_lobby"
    });
  });

  it("rejects reader IDs that are not in the trusted registry", () => {
    expect(() =>
      authorizeTerminalReaderSelection(
        { readerId: "tmr_browser_supplied" },
        "tmr_front_desk@tml_lobby"
      )
    ).toThrow("Terminal reader is not authorized");
  });

  it("rejects location spoofing for a trusted reader", () => {
    expect(() =>
      authorizeTerminalReaderSelection(
        { readerId: "tmr_front_desk", terminalLocationId: "tml_wrong" },
        "tmr_front_desk@tml_lobby"
      )
    ).toThrow("Terminal location does not match");
  });

  it("fails closed when a reader is supplied but no registry exists", () => {
    expect(() =>
      authorizeTerminalReaderSelection({ readerId: "tmr_front_desk" }, undefined)
    ).toThrow("Trusted Terminal reader registry is not configured");
  });

  it("parses comma-separated reader registry entries", () => {
    expect(parseTerminalReaderRegistry("tmr_front_desk@tml_lobby, tmr_bar")).toEqual([
      { readerId: "tmr_front_desk", terminalLocationId: "tml_lobby" },
      { readerId: "tmr_bar" }
    ]);
  });
});
