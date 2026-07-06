import { retiredSupabaseFunctions } from "../security/check-legacy-supabase-retirement.mjs";

const DEFAULT_TIMEOUT_MS = 10_000;
const baseUrlInput = process.env.SKYLA_SUPABASE_RETIREMENT_BASE_URL ?? process.env.SUPABASE_FUNCTION_BASE_URL ?? "";
const anonKey = process.env.SKYLA_SUPABASE_RETIREMENT_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const timeoutMs = Number.parseInt(
  process.env.SKYLA_SUPABASE_RETIREMENT_TIMEOUT_MS ?? process.env.SUPABASE_RETIREMENT_TIMEOUT_MS ?? `${DEFAULT_TIMEOUT_MS}`,
  10
);
const selectedFunctions = commaList(
  process.env.SKYLA_SUPABASE_RETIREMENT_FUNCTIONS ?? process.env.SUPABASE_RETIREMENT_FUNCTIONS ?? ""
);
const allowDisabled =
  process.env.SKYLA_SUPABASE_RETIREMENT_ALLOW_DISABLED === "1" ||
  process.env.SUPABASE_RETIREMENT_ALLOW_DISABLED === "1";
const liveConfirmed =
  process.env.SKYLA_SUPABASE_RETIREMENT_LIVE === "1" ||
  process.env.SUPABASE_RETIREMENT_LIVE === "1";

export const retiredFunctionProbes = retiredSupabaseFunctions.map((entry) => {
  const functionName = entry.path.split("/")[2];
  return {
    functionName,
    label: entry.label,
    body: probeBodyFor(functionName),
    expectedMarkers: entry.requiredMarkers
  };
});

function commaList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function probeBodyFor(functionName) {
  return {
    skylaRetirementProbe: true,
    action: functionName === "stripe-terminal" ? "__skyla_retirement_probe__" : undefined
  };
}

function normalizeBaseUrl(value) {
  if (!value) {
    throw new Error(
      "SKYLA_SUPABASE_RETIREMENT_BASE_URL is required, for example https://<project-ref>.supabase.co/functions/v1"
    );
  }
  return new URL(value.endsWith("/") ? value : `${value}/`);
}

function isLocalBaseUrl(url) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

function headers() {
  const output = {
    "content-type": "application/json",
    "x-skyla-retirement-probe": "1"
  };
  if (anonKey) {
    output.apikey = anonKey;
    output.authorization = `Bearer ${anonKey}`;
  }
  return output;
}

function containsExpectedMarker(text, markers) {
  return markers.some((marker) => text.includes(marker));
}

function classify(status, text, expectedMarkers) {
  if (status === 410 && containsExpectedMarker(text, expectedMarkers)) return "retired";
  if (status === 410) return "inconclusive";
  if (status === 404 && allowDisabled) return "disabled";
  if (status === 404) return "inconclusive";
  if (status === 401 || status === 403) return "inconclusive";
  return "failed";
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function runSupabaseRetirementSmoke({ baseUrl, probes = retiredFunctionProbes } = {}) {
  const root = normalizeBaseUrl(baseUrl ?? baseUrlInput);
  if (!isLocalBaseUrl(root) && !liveConfirmed) {
    throw new Error(
      "Set SKYLA_SUPABASE_RETIREMENT_LIVE=1 to confirm you are intentionally probing a live Supabase functions host."
    );
  }
  const selected = selectedFunctions.length > 0
    ? probes.filter((probe) => selectedFunctions.includes(probe.functionName))
    : probes;

  if (selected.length === 0) {
    throw new Error("No Supabase functions selected for retirement smoke.");
  }

  const results = [];
  for (const probe of selected) {
    const url = new URL(probe.functionName, root);
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(probe.body)
    });
    const text = await response.text().catch(() => "");
    results.push({
      ...probe,
      url: url.href,
      status: response.status,
      classification: classify(response.status, text, probe.expectedMarkers),
      bodyPreview: text.slice(0, 240)
    });
  }

  return results;
}

function printResults(results) {
  const failures = [];
  console.log("Supabase retirement smoke results:");
  for (const result of results) {
    const status = `${result.status} ${result.classification}`;
    console.log(`- ${result.functionName}: ${status}`);
    if (result.classification === "inconclusive") {
      if (result.status === 404) {
        failures.push(
          `${result.functionName}: got 404; set SKYLA_SUPABASE_RETIREMENT_ALLOW_DISABLED=1 only after confirming the project and function names in Supabase`
        );
      } else if (result.status === 410) {
        failures.push(`${result.functionName}: got 410 without the expected retired repo marker`);
      } else {
        failures.push(
          `${result.functionName}: got ${result.status}; pass SKYLA_SUPABASE_RETIREMENT_ANON_KEY or disable/redeploy the function so it returns retired 410`
        );
      }
    } else if (result.classification === "failed") {
      failures.push(`${result.functionName}: got ${result.status}; expected disabled 404 or retired 410`);
    }
  }

  if (failures.length > 0) {
    console.error("Supabase retirement smoke failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Supabase retirement smoke passed. All probed functions are disabled or fail-closed retired.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const results = await runSupabaseRetirementSmoke();
    printResults(results);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
