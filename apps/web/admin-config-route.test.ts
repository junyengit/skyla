import { fetchMutation, fetchQuery } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./app/api/admin/config/route";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn()
}));

const fetchQueryMock = vi.mocked(fetchQuery);
const fetchMutationMock = vi.mocked(fetchMutation);

const hours = {
  Monday: { open: "09:00", close: "00:00", closed: false },
  Tuesday: { open: "09:00", close: "00:00", closed: false },
  Wednesday: { open: "09:00", close: "00:00", closed: false },
  Thursday: { open: "09:00", close: "00:00", closed: false },
  Friday: { open: "09:00", close: "00:00", closed: false },
  Saturday: { open: "09:00", close: "00:00", closed: false },
  Sunday: { open: "09:00", close: "00:00", closed: false }
};

function request(body?: unknown, init?: RequestInit) {
  return new Request("https://skydeckla.com/api/admin/config", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
  fetchMutationMock.mockReset();
});

describe("/api/admin/config", () => {
  it("requires staff auth before checking Convex configuration", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "staff_auth_required"
    });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured after staff auth", async () => {
    const response = await GET(request(undefined, { headers: { authorization: "Bearer staff.jwt.token" } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "convex_unconfigured"
    });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("loads the config snapshot with the staff bearer token", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      staff: { emailLower: "admin@example.com", role: "admin" },
      config: {
        announcement: { active: false, text: "", type: "info" },
        hours
      },
      state: {
        announcement: { invalid: false },
        hours: { invalid: false }
      },
      editableKeys: ["announcement", "hours"]
    });

    const response = await GET(request(undefined, { headers: { authorization: "Bearer staff.jwt.token" } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      config: {
        announcement: { active: false, text: "", type: "info" }
      }
    });
    expect(fetchQueryMock).toHaveBeenCalledWith(expect.anything(), {}, {
      url: "https://example.convex.cloud",
      token: "staff.jwt.token"
    });
  });

  it("rejects unknown config keys before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(
      request(
        { key: "pricing", data: {} },
        {
          headers: { authorization: "Bearer staff.jwt.token" }
        }
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "config key is not recognized"
    });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("rejects malformed hours before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(
      request(
        {
          key: "hours",
          data: {
            ...hours,
            Friday: { open: "9:00", close: "00:00", closed: false }
          }
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "hours.Friday.open must be HH:mm"
    });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("updates announcement config without browser-controlled price data", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({
      key: "announcement",
      data: { active: true, text: "<img src=x onerror=alert(1)>", type: "warning" },
      updatedAt: 1783214400000
    });

    const response = await POST(
      request(
        {
          key: "announcement",
          data: {
            active: true,
            text: " <img src=x onerror=alert(1)> ",
            type: "warning",
            amountCents: 1
          },
          note: " launch "
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      config: {
        key: "announcement",
        data: { active: true, text: "<img src=x onerror=alert(1)>", type: "warning" }
      }
    });
    expect(fetchMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        key: "announcement",
        data: {
          active: true,
          text: "<img src=x onerror=alert(1)>",
          type: "warning"
        },
        note: "launch"
      },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });
});
