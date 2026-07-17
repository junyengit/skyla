import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { unstable_cache } from "next/cache";

import {
  operatingWeekdays,
  parsePublicOperatingConfig,
  type OperatingHours,
  type PublicOperatingConfig
} from "./operating-hours";

const getPublicOperatingConfigQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
  "publicConfig:getPublicOperatingConfig"
);

function convexDeploymentUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

// 6100 Wilshire building hours; shown while the Convex-managed config is unreachable.
const unavailableOperatingHours = Object.fromEntries(
  operatingWeekdays.map((day) => [
    day,
    day === "Saturday" || day === "Sunday"
      ? { open: "00:00", close: "00:00", closed: true }
      : { open: "09:00", close: "18:00", closed: false }
  ])
) as OperatingHours;

export const unavailablePublicOperatingConfig: PublicOperatingConfig = {
  announcement: {
    text: "Online booking is temporarily unavailable. Please try again shortly.",
    type: "warning"
  },
  operatingHours: unavailableOperatingHours,
  timeZone: "America/Los_Angeles"
};

const loadCachedPublicOperatingConfig = unstable_cache(
  async (deploymentUrl: string) => {
    const result = await fetchQuery(getPublicOperatingConfigQuery, {}, { url: deploymentUrl });
    return parsePublicOperatingConfig(result);
  },
  ["skyla-public-operating-config"],
  { revalidate: 60 }
);

export async function loadPublicOperatingConfig(): Promise<PublicOperatingConfig> {
  const deploymentUrl = convexDeploymentUrl();
  if (!deploymentUrl) return unavailablePublicOperatingConfig;

  try {
    return (await loadCachedPublicOperatingConfig(deploymentUrl)) ?? unavailablePublicOperatingConfig;
  } catch (error) {
    console.error("Failed to load public operating config from Convex; serving fallback hours.", error);
    return unavailablePublicOperatingConfig;
  }
}
