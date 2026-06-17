#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SECRET_DEFINITIONS = Object.freeze({
  VERCEL_TOKEN: Object.freeze({
    name: "VERCEL_TOKEN",
    service: "ezohata-ledger-vercel",
    account: "VERCEL_TOKEN",
    label: "EzoHata Ledger / Vercel - VERCEL_TOKEN",
    walletUrl: "http://127.0.0.1:8789/secrets"
  })
});

function usage() {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/wallet.mjs list",
      "  node scripts/wallet.mjs set VERCEL_TOKEN",
      "  node scripts/wallet.mjs has VERCEL_TOKEN",
      "  node scripts/wallet.mjs run -- <command> [args...]"
    ].join("\n") + "\n"
  );
}

function getSecretDefinition(name = "") {
  return SECRET_DEFINITIONS[String(name || "").trim()];
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: options.stdio || ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", (error) => {
      resolve({ ok: false, code: 127, stdout, stderr: String(error?.message || error) });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr });
    });
  });
}

function maskValue(value = "") {
  const text = String(value || "").trim();
  if (!text) return "missing";
  if (text.length <= 8) return "********";
  return `${text.slice(0, 2)}******${text.slice(-2)}`;
}

async function readKeychain(definition, options = {}) {
  const result = await (options.runCommand || runCommand)("security", [
    "find-generic-password",
    "-s", definition.service,
    "-a", definition.account,
    "-w"
  ]);
  return {
    ok: result.ok,
    value: result.ok ? String(result.stdout || "").trimEnd() : "",
    stderr: result.stderr || result.stdout || ""
  };
}

async function writeKeychain(definition, value, options = {}) {
  const result = await (options.runCommand || runCommand)("security", [
    "add-generic-password",
    "-U",
    "-s", definition.service,
    "-a", definition.account,
    "-w", value
  ]);
  return {
    ok: result.ok,
    stderr: result.stderr || result.stdout || ""
  };
}

async function promptHidden(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive terminal is required for set.");
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const previousRaw = stdin.isRaw;
    let value = "";

    function cleanup() {
      stdin.off("data", onData);
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(Boolean(previousRaw));
      }
      stdin.pause();
      stdout.write("\n");
    }

    function onData(chunk) {
      const text = String(chunk);
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }

    stdout.write(`${promptText}: `);
    stdin.setEncoding("utf8");
    stdin.resume();
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.on("data", onData);
  });
}

export async function listSecretStatuses(options = {}) {
  const entries = Object.values(SECRET_DEFINITIONS);
  const rows = [];
  for (const entry of entries) {
    const status = await readKeychain(entry, options);
    rows.push({
      name: entry.name,
      status: status.ok && status.value ? "configured" : "missing",
      walletUrl: entry.walletUrl
    });
  }
  return rows;
}

export async function hasSecret(name, options = {}) {
  const definition = getSecretDefinition(name);
  if (!definition) {
    throw new Error(`Unsupported secret: ${name}`);
  }
  const result = await readKeychain(definition, options);
  return Boolean(result.ok && result.value);
}

export async function loadWalletEnv(options = {}) {
  const env = { ...process.env };
  for (const entry of Object.values(SECRET_DEFINITIONS)) {
    const result = await readKeychain(entry, options);
    if (result.ok && result.value) {
      env[entry.name] = result.value;
    }
  }
  return env;
}

async function handleList() {
  const rows = await listSecretStatuses();
  for (const row of rows) {
    process.stdout.write(`${row.name}\t${row.status}\t${row.walletUrl}\n`);
  }
}

async function handleSet(secretName) {
  const definition = getSecretDefinition(secretName);
  if (!definition) {
    throw new Error(`Unsupported secret: ${secretName}`);
  }
  const value = await promptHidden(`Enter ${definition.name}`);
  if (!value) {
    throw new Error(`${definition.name} was empty.`);
  }
  const result = await writeKeychain(definition, value);
  if (!result.ok) {
    throw new Error(`Failed to store ${definition.name} in macOS Keychain.`);
  }
  process.stdout.write(`${definition.name}: configured in macOS Keychain\n`);
  process.stdout.write(`wallet url: ${definition.walletUrl}\n`);
}

async function handleHas(secretName) {
  const definition = getSecretDefinition(secretName);
  if (!definition) {
    throw new Error(`Unsupported secret: ${secretName}`);
  }
  const present = await hasSecret(secretName);
  process.stdout.write(`${definition.name}: ${present ? "configured" : "missing"}\n`);
  process.exitCode = present ? 0 : 1;
}

async function handleRun(commandArgs) {
  if (!commandArgs.length) {
    throw new Error("wallet run requires a command after --");
  }
  const env = await loadWalletEnv();
  const loadedSecrets = Object.values(SECRET_DEFINITIONS)
    .filter((entry) => Boolean(env[entry.name]))
    .map((entry) => `${entry.name}=${maskValue(env[entry.name])}`);
  process.stdout.write(`wallet: loaded ${loadedSecrets.join(", ") || "no secrets"}\n`);
  const child = spawn(commandArgs[0], commandArgs.slice(1), {
    cwd: process.cwd(),
    env,
    stdio: "inherit"
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
  process.exitCode = exitCode;
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    usage();
    process.exitCode = command ? 0 : 1;
    return;
  }
  if (command === "list") {
    await handleList();
    return;
  }
  if (command === "set") {
    await handleSet(rest[0]);
    return;
  }
  if (command === "has") {
    await handleHas(rest[0]);
    return;
  }
  if (command === "run") {
    const dashIndex = rest.indexOf("--");
    const commandArgs = dashIndex >= 0 ? rest.slice(dashIndex + 1) : rest;
    await handleRun(commandArgs);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
