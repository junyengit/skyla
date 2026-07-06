import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export const retiredSupabaseFunctions = [
  {
    path: "supabase/functions/stripe-checkout/index.ts",
    label: "Stripe Checkout",
    requiredMarkers: ["permanently disabled", "Next.js/Convex checkout flow"]
  },
  {
    path: "supabase/functions/stripe-terminal/index.ts",
    label: "Stripe Terminal",
    requiredMarkers: ["permanently disabled", "Next.js/Convex POS saleRef payment flow"]
  },
  {
    path: "supabase/functions/stripe-webhook/index.ts",
    label: "Stripe webhook",
    requiredMarkers: ["legacy_stripe_webhook_retired", "Stripe webhook reconciliation has moved to Convex"]
  },
  {
    path: "supabase/functions/kaskade-payment/index.ts",
    label: "Kaskade payment",
    requiredMarkers: ["permanently disabled", "Next.js/Convex payment flow"]
  },
  {
    path: "supabase/functions/kaskade-webhook/index.ts",
    label: "Kaskade webhook",
    requiredMarkers: ["legacy Kaskade webhook retired"]
  }
];

const forbiddenActivePatterns = [
  {
    pattern: /\bwithSupabase\s*\(/,
    message: "retired functions must return before initializing Supabase helpers"
  },
  {
    pattern: /jsr:@supabase\/server/,
    message: "retired functions must not import Supabase server helpers"
  },
  {
    pattern: /\bnew\s+Stripe\s*\(/,
    message: "retired functions must not initialize Stripe SDK clients"
  },
  {
    pattern: /\bstripe\.(checkout|paymentIntents|terminal|webhookEndpoints)\b/,
    message: "retired functions must not call Stripe APIs"
  },
  {
    pattern: /https:\/\/api\.stripe\.com/,
    message: "retired functions must not call Stripe REST APIs"
  },
  {
    pattern: /\bfetch\s*\([^)]*kaskade/i,
    message: "retired functions must not call Kaskade APIs"
  }
];

function hasRetiredStatus(contents) {
  return /\bstatus\s*[:=]\s*410\b/.test(contents) || /,\s*410\s*\)/.test(contents);
}

export function evaluateLegacySupabaseRetirement(root = repoRoot) {
  const failures = [];

  for (const retiredFunction of retiredSupabaseFunctions) {
    let contents;
    try {
      contents = readFileSync(join(root, retiredFunction.path), "utf8");
    } catch (error) {
      failures.push(`${retiredFunction.path}: missing retired ${retiredFunction.label} stub`);
      continue;
    }

    if (!hasRetiredStatus(contents)) {
      failures.push(`${retiredFunction.path}: retired ${retiredFunction.label} stub must return HTTP 410`);
    }

    for (const marker of retiredFunction.requiredMarkers) {
      if (!contents.includes(marker)) {
        failures.push(`${retiredFunction.path}: missing retired marker "${marker}"`);
      }
    }

    for (const { pattern, message } of forbiddenActivePatterns) {
      if (pattern.test(contents)) {
        failures.push(`${retiredFunction.path}: ${message}`);
      }
    }
  }

  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = evaluateLegacySupabaseRetirement();

  if (failures.length > 0) {
    console.error("Legacy Supabase retirement guard failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Legacy Supabase retirement guard passed for ${retiredSupabaseFunctions.length} functions.`);
}
