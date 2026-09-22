// Shared low-level D1 execution helpers, used by every importer script.
// Everything goes through `wrangler d1 execute` — no separate driver/credentials.

import { spawnSync } from "node:child_process";

export function createD1Client(dbName, mode) {
  function runWrangler(args) {
    const result = spawnSync("npx", ["wrangler", ...args], { encoding: "utf-8", maxBuffer: 1024 * 1024 * 32 });
    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
      throw new Error(`wrangler ${args.join(" ")} failed (exit code ${result.status})`);
    }
    return result.stdout;
  }

  return {
    runD1Json(sql) {
      const stdout = runWrangler(["d1", "execute", dbName, mode, "--json", "--command", sql]);
      return JSON.parse(stdout);
    },
    runD1File(filePath) {
      runWrangler(["d1", "execute", dbName, mode, "--file", filePath]);
    },
  };
}

export function sqlStr(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function sqlNum(v) {
  if (v === null || v === undefined) return "NULL";
  return String(Number(v));
}
