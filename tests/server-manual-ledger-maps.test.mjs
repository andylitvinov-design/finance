import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeManualLedgerSource,
  resolveManualLedgerSource,
} from "../server/manual-ledger-maps.js";

test("server manual ledger maps preserve generic import sources", () => {
  for (const source of ["file_import", "csv_import", "xlsx_import", "pdf_import"]) {
    assert.equal(normalizeManualLedgerSource(source), source);
    assert.equal(resolveManualLedgerSource("", `${source}:statement:row-1`, "other"), source);
  }
});

test("server manual ledger maps normalize Revolut source aliases", () => {
  assert.equal(normalizeManualLedgerSource("revolut"), "revolut");
  assert.equal(normalizeManualLedgerSource("револют"), "revolut");
  assert.equal(normalizeManualLedgerSource("revolut_usd"), "revolut");
  assert.equal(normalizeManualLedgerSource("revolut dol"), "revolut");
  assert.equal(resolveManualLedgerSource("", "revolut:abc123", "other"), "revolut");
});
