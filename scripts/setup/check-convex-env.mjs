import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [".env.local", "apps/web/.env.local"];

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    result[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

const fileEnv = Object.assign({}, ...files.map((file) => parseEnvFile(resolve(file))));
const env = { ...fileEnv, ...process.env };
const deployment = env.CONVEX_DEPLOYMENT ?? "";
const publicUrl = env.NEXT_PUBLIC_CONVEX_URL ?? "";
const serverUrl = env.CONVEX_URL ?? "";

const checks = [
  {
    name: "CONVEX_DEPLOYMENT",
    present: Boolean(deployment),
    ok: Boolean(deployment && !deployment.startsWith("anonymous")),
    note: deployment.startsWith("anonymous") ? "anonymous local deployment is not a cloud link" : undefined
  },
  {
    name: "NEXT_PUBLIC_CONVEX_URL",
    present: Boolean(publicUrl),
    ok: /^https:\/\/.+\.convex\.cloud$/.test(publicUrl),
    note: publicUrl ? "required by the Next checkout route on Vercel" : undefined
  },
  {
    name: "CONVEX_URL",
    present: Boolean(serverUrl),
    ok: /^https:\/\/.+\.convex\.cloud$/.test(serverUrl) || /^http:\/\/127\.0\.0\.1:\d+$/.test(serverUrl),
    note: serverUrl ? "useful for local server-side checks; production should prefer NEXT_PUBLIC_CONVEX_URL" : undefined
  }
];

const output = {
  filesChecked: files,
  readyForCloudPersistence: checks[0].ok && checks[1].ok,
  checks
};

console.log(JSON.stringify(output, null, 2));

if (!output.readyForCloudPersistence) {
  process.exitCode = 1;
}
