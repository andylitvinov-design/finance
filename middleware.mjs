const REALM = "EzoHata Incoming Ledger";

function privateResponse(status) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (status === 401) {
    headers.set("WWW-Authenticate", `Basic realm="${REALM}", charset="UTF-8"`);
  }
  return new Response(
    status === 503 ? "Private access is not configured." : "Authentication required.",
    { status, headers },
  );
}

export function parseBasicAuthorization(value) {
  const match = /^Basic\s+(.+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  try {
    const decoded = atob(match[1]);
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

async function digest(value) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))),
  );
}

export async function constantTimeEqual(actual, expected) {
  const [left, right] = await Promise.all([digest(actual), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export default async function middleware(request) {
  const expectedToken = String(process.env.FINANCE_DASHBOARD_ACCESS_TOKEN || "").trim();
  if (!expectedToken) {
    return privateResponse(503);
  }

  const credentials = parseBasicAuthorization(request.headers.get("authorization"));
  if (
    !credentials ||
    credentials.username !== "owner" ||
    !(await constantTimeEqual(credentials.password, expectedToken))
  ) {
    return privateResponse(401);
  }

  // No response means Vercel continues to the requested static asset or API route.
}

export const config = {
  runtime: "edge",
};
