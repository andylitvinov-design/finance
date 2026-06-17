import test from "node:test";
import assert from "node:assert/strict";

import { hasSecret, listSecretStatuses, loadWalletEnv } from "../scripts/wallet.mjs";

function configuredRunner(command, args) {
  assert.equal(command, "security");
  assert.deepEqual(args.slice(0, 1), ["find-generic-password"]);
  return Promise.resolve({ ok: true, code: 0, stdout: "secret-value\n", stderr: "" });
}

function missingRunner() {
  return Promise.resolve({ ok: false, code: 44, stdout: "", stderr: "missing" });
}

test("listSecretStatuses reports configured status without returning values", async () => {
  const rows = await listSecretStatuses({ runCommand: configuredRunner });
  assert.deepEqual(rows, [
    {
      name: "VERCEL_TOKEN",
      status: "configured",
      walletUrl: "http://127.0.0.1:8789/secrets"
    }
  ]);
});

test("hasSecret returns false when keychain entry is missing", async () => {
  assert.equal(await hasSecret("VERCEL_TOKEN", { runCommand: missingRunner }), false);
});

test("loadWalletEnv injects supported secrets into the child env", async () => {
  const env = await loadWalletEnv({ runCommand: configuredRunner });
  assert.equal(env.VERCEL_TOKEN, "secret-value");
});
