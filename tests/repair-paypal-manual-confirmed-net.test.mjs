import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPayPalManualNetRepair,
  PAYPAL_MANUAL_CONFIRMATIONS,
} from "../scripts/repair-paypal-manual-confirmed-net.mjs";
import { normalizePayPalTransactionDetails } from "../api/paypal-transactions.js";

const HEADER = [
  "date",
  "operation",
  "from_channel",
  "to_channel",
  "amount",
  "currency",
  "amount_usd",
  "amount_gross",
  "amount_fee",
  "amount_net",
  "category",
  "subcategory",
  "direction",
  "comment",
  "counterparty",
  "description",
  "source",
  "external_id",
  "raw_source_id",
  "transfer_group_id",
  "created_at",
  "updated_at",
];

test("generic PayPal income with missing fee keeps amount_net null", () => {
  const [entry] = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "GENERIC-MISSING-FEE",
        transaction_initiation_date: "2026-05-19T12:00:00Z",
        transaction_amount: { value: "3.50", currency_code: "EUR" },
      },
    },
  ]);

  assert.equal(entry.direction, "income");
  assert.equal(entry.grossAmount, 3.5);
  assert.equal(entry.feeAmount, null);
  assert.equal(entry.amount_net, null);
});

test("manual PayPal confirmations set amount_fee and amount_net only for the two confirmed raw IDs", () => {
  const values = buildLedgerValues();
  const result = buildPayPalManualNetRepair(values);

  assert.equal(result.ok, true);
  assert.equal(result.targets.length, 2);
  assert.deepEqual(result.targets.map((target) => target.rawSourceId), [
    "51J71784GD5986719",
    "7CW85848UD033154F",
  ]);
  assert.deepEqual(result.targets.map((target) => target.sheetRowNumber), [93, 489]);

  const first = result.targets[0];
  assert.equal(first.nextAmountFee, "0");
  assert.equal(first.nextAmountNet, "200");
  assert.equal(first.nextSource, "paypal_personal_manual");
  assert.match(first.nextRow[HEADER.indexOf("comment")], /paid to PayPal balance EUR 200/);

  const refund = result.targets[1];
  assert.equal(refund.nextAmountFee, "0");
  assert.equal(refund.nextAmountNet, "3.5");
  assert.equal(refund.nextSource, "paypal_personal_manual");
  assert.match(refund.nextRow[HEADER.indexOf("comment")], /PayPal refund manual confirmation/);
});

test("manual PayPal repair rejects duplicate raw_source_id rows", () => {
  const values = buildLedgerValues();
  values.push(values[92].slice());
  const result = buildPayPalManualNetRepair(values);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /51J71784GD5986719: expected exactly one Ledger row, found 2/);
});

test("manual PayPal repair rejects mismatched target rows", () => {
  const values = buildLedgerValues();
  values[92][HEADER.indexOf("currency")] = "USD";
  const result = buildPayPalManualNetRepair(values);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /expected currency EUR, found USD/);
});

test("manual PayPal repair rejects non-empty different amount_net", () => {
  const values = buildLedgerValues();
  values[488][HEADER.indexOf("amount_net")] = "4";
  const result = buildPayPalManualNetRepair(values);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /old amount_net is non-empty and different: 4/);
});

function buildLedgerValues() {
  const values = [HEADER];
  while (values.length < 489) {
    values.push(blankRow());
  }

  values[92] = ledgerRow({
    date: "2026-04-21",
    operation: "income",
    toChannel: "пейпал евр",
    amount: "200",
    currency: "EUR",
    amountUsd: "232",
    amountGross: "200",
    source: "paypal",
    rawSourceId: "51J71784GD5986719",
  });
  values[488] = ledgerRow({
    date: "2026-05-19",
    operation: "income",
    toChannel: "пейпал евр",
    amount: "3.5",
    currency: "EUR",
    amountUsd: "4.06",
    amountGross: "3.5",
    source: "paypal",
    rawSourceId: "7CW85848UD033154F",
  });

  assert.equal(PAYPAL_MANUAL_CONFIRMATIONS.length, 2);
  return values;
}

function blankRow() {
  return Array.from({ length: HEADER.length }, () => "");
}

function ledgerRow({ date, operation, toChannel, amount, currency, amountUsd, amountGross, source, rawSourceId }) {
  const row = blankRow();
  row[HEADER.indexOf("date")] = date;
  row[HEADER.indexOf("operation")] = operation;
  row[HEADER.indexOf("to_channel")] = toChannel;
  row[HEADER.indexOf("amount")] = amount;
  row[HEADER.indexOf("currency")] = currency;
  row[HEADER.indexOf("amount_usd")] = amountUsd;
  row[HEADER.indexOf("amount_gross")] = amountGross;
  row[HEADER.indexOf("category")] = "servicein";
  row[HEADER.indexOf("direction")] = "in";
  row[HEADER.indexOf("source")] = source;
  row[HEADER.indexOf("raw_source_id")] = rawSourceId;
  return row;
}
