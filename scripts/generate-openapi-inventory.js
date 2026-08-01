#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { buildEndpointInventoryArtifact } from "../src/services/openWeatherEndpoints.js";

const OUTPUT_DIR = "artifacts";
const OUTPUT_FILE = `${OUTPUT_DIR}/openweather-onecall4-inventory.json`;

async function main() {
  const artifact = buildEndpointInventoryArtifact();
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`${OUTPUT_FILE}\n`);
}

main().catch((error) => {
  process.stderr.write(`[inventory][error] ${error?.stack ?? error?.message ?? String(error)}\n`);
  process.exit(1);
});
