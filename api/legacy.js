const SUPPORTED_ACTIONS = new Set([
  "listManualSheetDates",
  "getManualSheet",
  "saveManualSheet",
]);

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }

  if (request.method === "GET" && request.query.health === "1") {
    return response.status(200).json({
      ok: true,
      service: "ezohata-legacy-manual-finance-proxy",
      configured: Boolean(normalizeUpstreamUrl(process.env.EZOHATA_LEGACY_MANUAL_FINANCE_URL)),
    });
  }

  const upstream = normalizeUpstreamUrl(process.env.EZOHATA_LEGACY_MANUAL_FINANCE_URL);
  if (!upstream) {
    return response.status(503).json({
      ok: false,
      error: "Missing EZOHATA_LEGACY_MANUAL_FINANCE_URL environment variable.",
    });
  }

  try {
    if (request.method === "GET") {
      return await forwardGet(request, response, upstream);
    }
    if (request.method === "POST") {
      return await forwardPost(request, response, upstream);
    }
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  } catch (error) {
    return response.status(502).json({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  }
}

function normalizeUpstreamUrl(value) {
  const raw = String(value || "").trim();
  return raw ? raw.replace(/\/+$/, "") : "";
}

function validateAction(action) {
  const normalized = String(action || "").trim();
  if (!SUPPORTED_ACTIONS.has(normalized)) {
    throw new Error(`Unsupported action: ${normalized || "unknown"}`);
  }
  return normalized;
}

async function forwardGet(request, response, upstream) {
  const action = validateAction(request.query.action || "getManualSheet");
  const target = new URL(upstream);
  target.searchParams.set("action", action);
  Object.entries(request.query || {}).forEach(([key, value]) => {
    if (key === "action" || key === "health" || value == null || value === "") return;
    target.searchParams.set(key, String(value));
  });
  const upstreamResponse = await fetch(target.toString(), {
    method: "GET",
    headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
  });
  return await pipeResponse(response, upstreamResponse, action);
}

async function forwardPost(request, response, upstream) {
  const payload =
    typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const action = validateAction(payload.action);
  const upstreamResponse = await fetch(upstream, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    },
    body: JSON.stringify({ ...payload, action }),
  });
  return await pipeResponse(response, upstreamResponse, action);
}

async function pipeResponse(response, upstreamResponse, action) {
  const text = await upstreamResponse.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Upstream returned non-JSON response for ${action}.`);
  }
  if (!upstreamResponse.ok) {
    return response.status(upstreamResponse.status).json({
      ok: false,
      action,
      error: payload?.error || `Upstream returned HTTP ${upstreamResponse.status}.`,
    });
  }
  return response.status(payload.ok ? 200 : 502).json({
    ok: Boolean(payload.ok),
    action: payload.action || action,
    ...(payload.ok ? { data: payload.data } : { error: payload.error || "Upstream returned an error." }),
  });
}
