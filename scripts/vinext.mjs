import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Pass the environment directly: shell-specific VAR=value syntax breaks on Windows.
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url)),
  ...process.argv.slice(2),
], {
  stdio: "inherit",
  env: { ...process.env, WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log" },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
