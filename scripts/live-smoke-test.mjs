// live-smoke-test.mjs — verify the live URL returns expected status and content
// Usage:
//   node scripts/live-smoke-test.mjs
//   LIVE_URL="https://ezohata-incoming-ledger.vercel.app" node scripts/live-smoke-test.mjs
//   EXPECTED_TEXT="EzoHata" node scripts/live-smoke-test.mjs

const liveUrl = process.env.LIVE_URL || 'https://ezohata-incoming-ledger.vercel.app';
const expectedText = process.env.EXPECTED_TEXT;
const expectedStatus = Number(process.env.EXPECTED_STATUS || 200);

let response;
try {
  response = await fetch(liveUrl, { redirect: 'follow' });
} catch (error) {
  console.error(`Live URL request failed: ${error.message}`);
  process.exit(1);
}

if (response.status !== expectedStatus) {
  console.error(`Unexpected status: expected ${expectedStatus}, got ${response.status}`);
  process.exit(1);
}

const body = await response.text();

if (expectedText && !body.includes(expectedText)) {
  console.error(`Expected text not found: ${expectedText}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  liveUrl,
  status: response.status,
  expectedText: expectedText || null,
  checkedAt: new Date().toISOString()
}, null, 2));
