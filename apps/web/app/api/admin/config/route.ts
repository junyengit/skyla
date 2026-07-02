import { fetchMutation, fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import {
  adminFailureStatus,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  optionalString,
  staffAuthRequiredResponse
} from "../_shared";

type AnnouncementType = "info" | "warning" | "success";
type ConfigKey = "announcement" | "hours";
type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

type AnnouncementConfig = {
  active: boolean;
  text: string;
  type: AnnouncementType;
};

type HoursDayConfig = {
  open: string;
  close: string;
  closed: boolean;
};

type HoursConfig = Record<Weekday, HoursDayConfig>;

type ConfigSnapshot = {
  staff: {
    emailLower: string;
    role: "admin" | "pos" | "viewer";
  };
  config: {
    announcement: AnnouncementConfig;
    hours: HoursConfig;
  };
  state: {
    announcement: { updatedAt?: number; updatedBy?: string; invalid: boolean };
    hours: { updatedAt?: number; updatedBy?: string; invalid: boolean };
  };
  editableKeys: ConfigKey[];
};

type ConfigUpdateRequest = {
  key?: unknown;
  data?: unknown;
  note?: unknown;
};

type ConfigUpdateArgs = {
  key: ConfigKey;
  data: AnnouncementConfig | HoursConfig;
  note?: string;
};

type ConfigUpdateResult = {
  key: ConfigKey;
  data: AnnouncementConfig | HoursConfig;
  updatedAt: number;
};

const weekdays: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const configKeys = new Set<ConfigKey>(["announcement", "hours"]);
const announcementTypes = new Set<AnnouncementType>(["info", "warning", "success"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const getConfigSnapshotQuery = makeFunctionReference<"query", Record<string, never>, ConfigSnapshot>(
  "admin:getConfigSnapshot"
);

const updateSiteConfigMutation = makeFunctionReference<"mutation", ConfigUpdateArgs, ConfigUpdateResult>(
  "admin:updateSiteConfig"
);

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function parseConfigKey(value: unknown) {
  if (typeof value !== "string" || !configKeys.has(value as ConfigKey)) {
    throw new Error("config key is not recognized");
  }
  return value as ConfigKey;
}

function parseAnnouncement(value: unknown): AnnouncementConfig {
  const data = objectRecord(value, "announcement");
  const text = stringValue(data.text, "announcement.text").trim();
  if (text.length > 180) {
    throw new Error("announcement.text must be 180 characters or fewer");
  }
  if (!announcementTypes.has(data.type as AnnouncementType)) {
    throw new Error("announcement.type is not recognized");
  }
  return {
    active: booleanValue(data.active, "announcement.active"),
    text,
    type: data.type as AnnouncementType
  };
}

function parseHours(value: unknown): HoursConfig {
  const data = objectRecord(value, "hours");
  const extraKeys = Object.keys(data).filter((key) => !weekdays.includes(key as Weekday));
  if (extraKeys.length) {
    throw new Error(`hours contains unknown day: ${extraKeys[0]}`);
  }

  return Object.fromEntries(
    weekdays.map((day) => {
      if (!(day in data)) {
        throw new Error(`hours.${day} is required`);
      }
      const entry = objectRecord(data[day], `hours.${day}`);
      const open = stringValue(entry.open, `hours.${day}.open`).trim();
      const close = stringValue(entry.close, `hours.${day}.close`).trim();
      if (!timePattern.test(open)) {
        throw new Error(`hours.${day}.open must be HH:mm`);
      }
      if (!timePattern.test(close)) {
        throw new Error(`hours.${day}.close must be HH:mm`);
      }
      return [
        day,
        {
          open,
          close,
          closed: booleanValue(entry.closed, `hours.${day}.closed`)
        }
      ];
    })
  ) as HoursConfig;
}

function parseConfigData(key: ConfigKey, value: unknown) {
  return key === "announcement" ? parseAnnouncement(value) : parseHours(value);
}

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Config");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Config");
    }

    const snapshot = await fetchQuery(getConfigSnapshotQuery, {}, { url: deploymentUrl, token });
    return Response.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Admin Config";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Config");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Config");
    }

    const input = (await request.json()) as ConfigUpdateRequest;
    const key = parseConfigKey(input.key);
    const result = await fetchMutation(
      updateSiteConfigMutation,
      withoutUndefined({
        key,
        data: parseConfigData(key, input.data),
        note: optionalString(input.note, "note", 160)
      }),
      { url: deploymentUrl, token }
    );

    return Response.json({ config: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Admin Config";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}
