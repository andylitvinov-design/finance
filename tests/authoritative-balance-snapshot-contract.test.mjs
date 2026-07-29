import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnerConfirmedJulySnapshotRows,
  composeAuthoritativeSnapshotRows,
  computeFactualSnapshotChange,
  parseSnapshotContractStatus,
  serializeSnapshotContractStatus,
} from "../server/authoritative-balance-snapshot-contract.js";

test("owner-confirmed full July batches preserve supplied USD totals and factual change", () => {
  const rows = buildOwnerConfirmedJulySnapshotRows({ createdAt: "2026-07-29T16:00:00.000Z" });
  const july1 = rows.filter((row) => row.date === "2026-07-01");
  const july29 = rows.filter((row) => row.date === "2026-07-29");

  assert.equal(july1.reduce((sum, row) => sum + row.amount_usd, 0), 21090.5);
  assert.equal(july29.reduce((sum, row) => sum + row.amount_usd, 0), 22454.5);
  assert.deepEqual(computeFactualSnapshotChange(july1, july29), {
    opening_total_usd: 21090.5,
    closing_total_usd: 22454.5,
    factual_change_usd: 1364,
  });
});

test("owner-confirmed July rows use registry owner keys and approved display labels", () => {
  const rows = buildOwnerConfirmedJulySnapshotRows();
  const july1 = rows.filter((row) => row.date === "2026-07-01");
  const july29 = rows.filter((row) => row.date === "2026-07-29");

  assert.equal(july1.length, 19);
  assert.equal(july29.length, 20);
  assert.equal(july1.some((row) => row.owner_key === "zen"), false);
  assert.equal(july29.find((row) => row.owner_key === "zen")?.channel, "ZEN");
  assert.deepEqual(july29.slice(0, 11).map((row) => row.channel), [
    "Яндекс", "PayPal USD", "PayPal EUR", "Dep24 USD", "Dep24 EUR", "PayPal CAD",
    "Privat24 UAH", "Monobank UAH", "Wise EUR", "Wise USD", "Revolut",
  ]);
  assert.equal(july29.find((row) => row.owner_key === "binance_spot")?.channel, "Binance Spot");
  assert.equal(july29.find((row) => row.owner_key === "bank_canada_cad")?.channel, "Bank Canada CAD");
});

test("a reliable owner-confirmed full batch excludes same-date provider, derived, OCR and legacy anchors", () => {
  const ownerRows = buildOwnerConfirmedJulySnapshotRows().filter((row) => row.date === "2026-07-01");
  const composition = composeAuthoritativeSnapshotRows([
    ...ownerRows,
    { date: "2026-07-01", channel: "Бинанс spot", currency: "USDT", amount: 999, amount_usd: 999, source: "provider", comment: "provider refresh" },
    { date: "2026-07-01", channel: "legacy combined binance spot funding", currency: "USDT", amount: 345, amount_usd: 345, source: "derived", comment: "legacy anchor" },
    { date: "2026-07-01", channel: "нал-мам-евро", currency: "EUR", amount: 500, amount_usd: 574, source: "ocr_confirmed" },
  ]);

  assert.equal(composition.rows.length, ownerRows.length);
  assert.equal(composition.authoritative_batches.length, 1);
  assert.equal(composition.authoritative_batches[0].total_usd, 21090.5);
  assert.equal(composition.excluded_rows.length, 3);
  assert.ok(composition.excluded_rows.every((row) => row.excluded_from_authoritative_total));
});

test("explicit zero and omitted channels remain distinct in the persisted status contract", () => {
  const encoded = serializeSnapshotContractStatus({
    snapshot_batch_id: "owner-confirmed-2026-07-01",
    completeness: "full",
    explicit_zero: true,
    representation: "standalone",
    metadata_reliability: "reliable",
    created_at: "2026-07-29T16:00:00.000Z",
    created_by: "owner",
  });
  const decoded = parseSnapshotContractStatus(encoded);

  assert.equal(decoded.explicit_zero, true);
  assert.equal(decoded.completeness, "full");
  assert.equal(decoded.omitted, undefined);
  assert.equal(parseSnapshotContractStatus("").metadata_reliability, "legacy_unreliable");
});

test("aggregate owner positions exclude component aliases only inside their authoritative batch", () => {
  const rows = buildOwnerConfirmedJulySnapshotRows().filter((row) => row.date === "2026-07-29");
  const spot = rows.find((row) => row.channel === "Binance Spot");
  const revolut = rows.find((row) => row.channel === "Revolut");
  const usdt = rows.find((row) => row.channel === "Binance Save USDT");

  assert.equal(spot.representation, "aggregate");
  assert.equal(revolut.representation, "aggregate");
  assert.equal(usdt.metadata_reliability, "needs_verification");
  assert.equal(usdt.amount_usd, 5075);
});
