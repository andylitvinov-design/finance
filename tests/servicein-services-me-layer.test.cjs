const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const configJs = fs.readFileSync(path.join(root, "config.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const layerJs = fs.readFileSync(path.join(root, "servicein-services-me-layer.js"), "utf8");

test("services_me is exposed as a manual received entry type", () => {
  assert.match(configJs, /MANUAL_RECEIVED_ENTRY_TYPES\s*=\s*\[[^\]]*"services_me"/s);
});

test("services-me layer loads after ui.js", () => {
  const uiIndex = indexHtml.indexOf("./ui.js");
  const layerIndex = indexHtml.indexOf("./servicein-services-me-layer.js");
  assert.ok(uiIndex !== -1, "ui.js script is present");
  assert.ok(layerIndex !== -1, "servicein layer script is present");
  assert.ok(layerIndex > uiIndex, "layer loads after ui.js so wrappers can patch globals");
});

test("servicein layer defines required helpers and excludes ezoin from services-me", () => {
  assert.match(layerJs, /function isServiceInRow\(row\)/);
  assert.match(layerJs, /function isServicesMeRow\(row\)/);
  assert.match(layerJs, /function buildServiceInIncomeLookup\(rows = \[\]\)/);
  assert.match(layerJs, /category === "servicein"/);
  assert.doesNotMatch(layerJs, /category === "ezoin" && direction === "in"/);
});

test("servicein layer preserves required save semantics for services_me", () => {
  assert.match(layerJs, /category: "servicein"/);
  assert.match(layerJs, /subcategory: SERVICE_TYPE/);
  assert.match(layerJs, /direction: "in"/);
  assert.match(layerJs, /operation: "income"/);
  assert.match(layerJs, /rawSourceId/);
  assert.match(layerJs, /externalId/);
});

test("servicein layer exposes order coverage candidate formula", () => {
  assert.match(layerJs, /function buildOrderCoverageCandidateSummary\(rows = \[\]\)/);
  assert.match(layerJs, /orderCandidateIncomingUsd: totalIncomingUsd - serviceinUsd - transferOrExchangeUsd/);
  assert.match(layerJs, /orderCandidateIncomingUsd = totalIncomingUsd - serviceinUsd - transferOrExchangeUsd/);
});
