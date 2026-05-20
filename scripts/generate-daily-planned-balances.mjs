#!/usr/bin/env node

import { runDailyPlannedBalances } from "../server/daily-planned-balances.js";

const args = parseArgs(process.argv.slice(2));

try {
  const result = await runDailyPlannedBalances({ query: args });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const output = { dryRun: "1" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      output.apply = "1";
      delete output.dryRun;
      continue;
    }
    if (arg === "--dry-run") {
      output.dryRun = "1";
      delete output.apply;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        output[key] = "1";
        continue;
      }
      output[key] = next;
      index += 1;
    }
  }
  return output;
}
