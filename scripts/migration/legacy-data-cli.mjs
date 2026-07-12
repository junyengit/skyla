import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { prepareLegacyExport, sha256 } from "./legacy-data.mjs";

export function runLegacyMigrationCli(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  if (options.rollback) return runRollback(options, env);
  if (options.summary) return runSummary(options, env);
  if (!options.input || !options.source) throw new Error("--input and --source are required");
  if (options.out && !options.exportedAt) throw new Error("--exported-at is required when writing review artifacts");

  const inputPath = resolve(options.input);
  const inputText = readFileSync(inputPath, "utf8");
  const payload = JSON.parse(inputText);
  const plan = prepareLegacyExport(payload, {
    source: options.source,
    exportedAt: options.exportedAt,
    batchSize: options.batchSize,
    inputHash: sha256(inputText)
  });
  printSummary(plan.manifest);

  if (options.out) {
    const outDir = migrationOutputDirectory(options.out);
    if (options.apply) verifyPlan(outDir, plan);
    else writePlan(outDir, plan);
  }
  if (plan.rejected.length > 0) {
    throw new Error(`${plan.rejected.length} legacy rows were quarantined; repair the export before applying`);
  }
  if (!options.apply) {
    console.log("Dry run only. Add --apply and --deployment after reviewing the manifest and batches.");
    return plan.manifest;
  }
  if (!options.out) throw new Error("--out is required with --apply so the reviewed manifest is retained");
  validateDeployment(options);
  return applyPlan(plan, options, env);
}

async function applyPlan(plan, options, env) {
  const target = migrationClient(options, env);
  validateRemoteWrite(options, target);
  const client = target.client;
  const migrationToken = migrationTokenFrom(env);
  const upsertBatch = makeFunctionReference("legacyMigration:upsertLegacyBatch");
  for (const batch of plan.batches) {
    try {
      const result = await client.mutation(upsertBatch, {
        migrationToken,
        source: batch.source,
        batchId: batch.batchId,
        kind: batch.kind,
        records: batch.records
      });
      console.log(JSON.stringify(result));
    } catch {
      throw new Error(`Convex import failed for batch ${batch.batchId}`);
    }
  }
  console.log(`Applied ${plan.batches.length} reviewed legacy migration batches.`);
  return plan.manifest;
}

async function runSummary(options, env) {
  if (!options.source) throw new Error("--source is required with --summary");
  validateDeployment(options);
  const client = migrationClient(options, env).client;
  const getSummary = makeFunctionReference("legacyMigration:getLegacyMigrationSummary");
  let result;
  try {
    result = await client.query(getSummary, {
      migrationToken: migrationTokenFrom(env),
      source: options.source
    });
  } catch {
    throw new Error("Convex reconciliation summary failed");
  }
  console.log(JSON.stringify(result, null, 2));
  if (options.out) await verifyReviewedBatches(client, options, env);
  return result;
}

async function verifyReviewedBatches(client, options, env) {
  const outDir = migrationOutputDirectory(options.out);
  const manifestPath = resolve(outDir, "manifest.json");
  const stat = lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("reviewed migration manifest must be a private regular file");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.formatVersion !== 1 ||
    manifest.source !== options.source ||
    !Array.isArray(manifest.batches) ||
    manifest.batches.length < 1 ||
    manifest.batchCount !== manifest.batches.length ||
    new Set(manifest.batches.map((batch) => batch.batchId)).size !== manifest.batches.length ||
    manifest.batches.some(
      (batch) =>
        !/^[A-Za-z0-9:_.-]{1,160}$/.test(batch.batchId) ||
        !["bookings", "members", "inquiries"].includes(batch.kind) ||
        !/^sha256:[a-f0-9]{64}$/.test(batch.inputHash) ||
        !Number.isInteger(batch.recordCount) ||
        batch.recordCount < 1 ||
        batch.recordCount > 50
    )
  ) {
    throw new Error("reviewed migration manifest does not match the requested source");
  }
  const expectedPlanHash = sha256(
    manifest.batches.map((batch) => ({ batchId: batch.batchId, contentHash: batch.inputHash }))
  );
  if (manifest.planHash !== expectedPlanHash) {
    throw new Error("reviewed migration manifest plan hash is invalid");
  }
  const verifyBatches = makeFunctionReference("legacyMigration:verifyLegacyMigrationBatches");
  for (let offset = 0; offset < manifest.batches.length; offset += 50) {
    const expected = manifest.batches.slice(offset, offset + 50).map((batch) => ({
      batchId: batch.batchId,
      inputHash: batch.inputHash
    }));
    const verification = await client.query(verifyBatches, {
      migrationToken: migrationTokenFrom(env),
      source: options.source,
      expected
    });
    if (
      !Array.isArray(verification?.results) ||
      verification.results.length !== expected.length ||
      expected.some(
        (batch, index) =>
          verification.results[index]?.batchId !== batch.batchId || verification.results[index]?.verified !== true
      )
    ) {
      throw new Error(`reviewed migration batches failed reconciliation at offset ${offset}`);
    }
  }
  console.log(`Verified all ${manifest.batches.length} reviewed batches against Convex.`);
}

async function runRollback(options, env) {
  validateDeployment(options);
  const target = migrationClient(options, env);
  validateRemoteWrite(options, target);
  const client = target.client;
  const rollbackBatch = makeFunctionReference("legacyMigration:rollbackLegacyBatch");
  try {
    const result = await client.mutation(rollbackBatch, {
      migrationToken: migrationTokenFrom(env),
      batchId: options.rollback
    });
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch {
    throw new Error(`Convex rollback failed for batch ${options.rollback}`);
  }
}

function parseArgs(argv) {
  const options = { apply: false, confirmProduction: false, batchSize: 25 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg === "--summary") options.summary = true;
    else if (
      [
        "--input",
        "--source",
        "--exported-at",
        "--out",
        "--deployment",
        "--convex-url",
        "--rollback",
        "--batch-size"
      ].includes(arg)
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--input") options.input = value;
      if (arg === "--source") options.source = value;
      if (arg === "--exported-at") options.exportedAt = value;
      if (arg === "--out") options.out = value;
      if (arg === "--deployment") options.deployment = value;
      if (arg === "--convex-url") options.convexUrl = value;
      if (arg === "--rollback") options.rollback = value;
      if (arg === "--batch-size") options.batchSize = Number(value);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function validateDeployment(options) {
  if (!options.deployment) throw new Error("--deployment is required");
}

function migrationTokenFrom(env) {
  const token = env.SKYLA_DATA_MIGRATION_TOKEN?.trim();
  if (!token || token.length < 32 || /\s/.test(token)) {
    throw new Error("SKYLA_DATA_MIGRATION_TOKEN must be a 32+ character temporary token without whitespace");
  }
  return token;
}

function migrationClient(options, env) {
  const value = options.convexUrl ?? env.CONVEX_URL ?? env.NEXT_PUBLIC_CONVEX_URL;
  if (!value) throw new Error("--convex-url or CONVEX_URL is required");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Convex URL is invalid");
  }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const validLocalProtocol = local && ["http:", "https:"].includes(url.protocol);
  if (!validLocalProtocol && (url.protocol !== "https:" || !url.hostname.endsWith(".convex.cloud"))) {
    throw new Error("Convex URL must use HTTPS on convex.cloud, or a local development host");
  }
  const normalizedUrl = url.toString().replace(/\/$/, "");
  return { client: new ConvexHttpClient(normalizedUrl), url: normalizedUrl, local };
}

function validateRemoteWrite(options, target) {
  if (!target.local && !options.confirmProduction) {
    throw new Error(
      `--confirm-production is required for every remote Convex write because the CLI cannot infer environment from ${target.url}`
    );
  }
}

function migrationOutputDirectory(value) {
  const migrationRoot = resolve(".migration");
  if (existsSync(migrationRoot)) assertPrivateDirectory(migrationRoot);
  const outDir = resolve(value);
  const pathFromRoot = relative(migrationRoot, outDir);
  if (
    !pathFromRoot ||
    pathFromRoot.startsWith("..") ||
    pathFromRoot.includes("/") ||
    pathFromRoot.includes("\\") ||
    resolve(migrationRoot, pathFromRoot) !== outDir
  ) {
    throw new Error("--out must be a subdirectory of the ignored repository .migration directory");
  }
  return outDir;
}

function writePlan(outDir, plan) {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(resolve(".migration"));
  assertPrivateDirectory(outDir);
  for (const file of planFiles(plan)) writeFileSync(resolve(outDir, file.name), file.content, { flag: "wx", mode: 0o600 });
  console.log(`Wrote reviewed migration artifacts to ${outDir}. Treat this directory as sensitive PII.`);
}

function verifyPlan(outDir, plan) {
  assertPrivateDirectory(outDir);
  for (const file of planFiles(plan)) {
    const filePath = resolve(outDir, file.name);
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error(`reviewed migration artifact is not a private regular file: ${file.name}`);
    }
    if (readFileSync(filePath, "utf8") !== file.content) {
      throw new Error(`reviewed migration artifact does not match the current export: ${file.name}`);
    }
  }
  console.log(`Verified immutable reviewed migration artifacts in ${outDir}.`);
}

function planFiles(plan) {
  return [
    { name: "manifest.json", content: `${JSON.stringify(plan.manifest, null, 2)}\n` },
    { name: "quarantine.json", content: `${JSON.stringify(plan.rejected, null, 2)}\n` },
    ...plan.batches.map((batch) => ({
      name: `${batch.batchId.replaceAll(":", "-")}.json`,
      content: `${JSON.stringify(batch, null, 2)}\n`
    }))
  ];
}

function assertPrivateDirectory(outDir) {
  const stat = lstatSync(outDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("migration artifact directory must be a private 0700 directory, not a symlink");
  }
}

function printSummary(manifest) {
  console.log(JSON.stringify(manifest, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(runLegacyMigrationCli()).catch((error) => {
    console.error(error instanceof Error ? error.message : "Legacy migration failed");
    process.exit(1);
  });
}
