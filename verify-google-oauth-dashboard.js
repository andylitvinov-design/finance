const assert = require("node:assert/strict");

function shouldRequireGoogleForDashboard(configured, accessToken) {
  return !configured || !accessToken;
}

function buildDirectDashboardTabs(configTabs, rawTables, startDate, endDate) {
  const tabs = {};
  for (const tab of configTabs) {
    if (tab.id === "manualFinance") continue;
    const rawTable = rawTables?.[tab.id];
    if (!rawTable) continue;
    tabs[tab.id] = {
      sheetName: rawTable.sheetName || tab.sheetName || tab.id,
      values: rawTable.values || [],
      summaryRows: [],
      headerRowIndex: 0,
      fetchedForPeriod: `${startDate}:${endDate}`
    };
  }
  return tabs;
}

assert.equal(shouldRequireGoogleForDashboard(true, ""), true);
assert.equal(shouldRequireGoogleForDashboard(true, "token"), false);
assert.equal(shouldRequireGoogleForDashboard(false, "token"), true);

const tabs = buildDirectDashboardTabs(
  [
    { id: "movement", sheetName: "движение средства" },
    { id: "analytics", sheetName: "аналитика" },
    { id: "manualFinance", sheetName: "fact" }
  ],
  {
    movement: { values: [["h"], ["1"]] },
    analytics: { values: [["a"], ["2"]] }
  },
  "2026-04-01",
  "2026-04-30"
);

assert.deepEqual(Object.keys(tabs), ["movement", "analytics"]);
assert.equal(tabs.movement.sheetName, "движение средства");
assert.equal(tabs.analytics.fetchedForPeriod, "2026-04-01:2026-04-30");

console.log("verify-google-oauth-dashboard: ok");
