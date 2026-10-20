#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const cliPath = resolve(rootDir, "apps/device-simulator/src/cli.ts");
const tsxPath = resolve(rootDir, "node_modules/.pnpm/node_modules/.bin/tsx.CMD");
const apiBase = process.env.API_BASE_URL || "http://localhost:3001";

const isWin = process.platform === "win32";
const execCmd = isWin ? tsxPath : "tsx";

const args = [cliPath, "--api", apiBase, ...process.argv.slice(2)];

const child = spawn(execCmd, args, {
  cwd: rootDir,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    API_BASE_URL: apiBase,
  },
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
