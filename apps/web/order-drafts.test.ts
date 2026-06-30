import { describe, expect, it } from "vitest";

import { POST } from "./app/api/order-drafts/checkout/route";

function request(body: unknown) {
  return new Request("http://localhost/api/order-drafts/checkout", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("/api/order-drafts/checkout", () => {
  it("returns canonical server-side totals from selected products", async () => {
    const response = await POST(
      request({
        packageKey: "general",
        adults: 2,
        children: 1,
        addons: { matcha: 1 },
        totalCents: 1
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      draft: {
        subtotalCents: 8100,
        feeCents: 405,
        totalCents: 8505
      }
    });
  });

  it("rejects inactive package selections", async () => {
    const response = await POST(request({ packageKey: "champagne-room", adults: 2 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Ticket package is not bookable"
    });
  });
});
