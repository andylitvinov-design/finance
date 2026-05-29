const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("servicein services-me layer is wired", () => {
  const config = fs.readFileSync(path.join(root, "config.js"), "utf8");
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const layer = fs.readFileSync(path.join(root, "servicein-services-me-layer.js"), "utf8");

  assert.ok(config.includes('"services_me"'));
  assert.ok(index.includes("./servicein-services-me-layer.js"));
  assert.ok(index.indexOf("./servicein-services-me-layer.js") > index.indexOf("./ui.js"));
  assert.ok(layer.includes("function isServiceInRow"));
  assert.ok(layer.includes("function isServicesMeRow"));
  assert.ok(layer.includes("function buildServiceInIncomeLookup"));
  assert.ok(layer.includes("orderCandidateIncomingUsd: totalIncomingUsd - serviceinUsd - transferOrExchangeUsd"));
});
