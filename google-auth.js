// ============================================================
// GOOGLE OAUTH
// ============================================================

async function initializeGoogleAuth() {
  if (!state.googleAuth.configured) return;
  await waitForGoogleAccounts();
  state.googleAuth.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: state.googleAuth.clientId,
    scope: state.googleAuth.scopes,
    callback: (response) => {
      if (response?.error) {
        setManualFinanceStatus(response.error, true);
        return;
      }
      state.googleAuth.accessToken = response.access_token || "";
      refreshAuthButtons();
      setManualFinanceStatus("Google Sheets access granted. Пересчитываю все вкладки.", false);
      loadDashboardData().catch(() => {});
    }
  });
  state.googleAuth.initialized = true;
}

function waitForGoogleAccounts() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const tick = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Google Identity Services failed to load."));
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

async function connectGoogle(interactive = true) {
  if (!state.googleAuth.configured) {
    setManualFinanceStatus("Сначала вставьте Google OAuth Client ID в sheet-config.json.", true);
    return;
  }
  if (!state.googleAuth.initialized) {
    await initializeGoogleAuth();
  }
  await new Promise((resolve, reject) => {
    state.googleAuth.tokenClient.callback = (response) => {
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      state.googleAuth.accessToken = response.access_token || "";
      refreshAuthButtons();
      setManualFinanceStatus("Google подключен. Пересчитываю все вкладки за выбранный период.", false);
      renderTabs();
      loadDashboardData().catch(() => {});
      resolve();
    };
    try {
      state.googleAuth.tokenClient.requestAccessToken({
        prompt: interactive && !state.googleAuth.accessToken ? "consent" : ""
      });
    } catch (error) {
      reject(error);
    }
  });
}

function disconnectGoogle() {
  if (state.googleAuth.accessToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(state.googleAuth.accessToken, () => {});
  }
  state.googleAuth.accessToken = "";
  state.manualFinance.data = null;
  state.manualOrders.data = null;
  refreshAuthButtons();
  renderMetrics();
  setStatus("Google доступ отключён. Серверные вкладки продолжают работать без авторизации.");
  setManualFinanceStatus("Google доступ отключён. Для fact и orders потребуется повторное подключение.", true);
  renderTabs();
}


// ============================================================
// AUTH UI AND READINESS
// ============================================================

function refreshAuthButtons() {
  const connected = Boolean(state.googleAuth.accessToken);
  elements.connectGoogleButton.textContent = connected ? "Google подключен" : "Подключить Google";
  elements.connectGoogleButton.disabled = connected || !state.googleAuth.configured;
  elements.disconnectGoogleButton.disabled = !connected;
  elements.manualEndpointLabel.textContent = connected
    ? "Connected via browser OAuth for fact/orders"
    : state.googleAuth.configured
      ? getOAuthReadinessMessage()
      : "Set googleAuth.clientId in sheet-config.json for fact/orders editing";
}

function getConfiguredOAuthOrigins() {
  return Array.isArray(state.config?.googleAuth?.authorizedJavaScriptOrigins)
    ? state.config.googleAuth.authorizedJavaScriptOrigins.map((origin) => String(origin || "").trim()).filter(Boolean)
    : [];
}

function isCurrentOriginDeclaredForOAuth() {
  const origins = getConfiguredOAuthOrigins();
  if (!origins.length) return false;
  return origins.includes(window.location.origin);
}

function getOAuthReadinessMessage() {
  const currentOrigin = window.location.origin;
  if (isCurrentOriginDeclaredForOAuth()) {
    return `OAuth configured for ${currentOrigin}. Browser login still must be verified manually in Google.`;
  }
  return `OAuth client configured, but ${currentOrigin} is not listed in sheet-config authorizedJavaScriptOrigins. Add it in config and Google Cloud Console.`;
}

function refreshGoogleControlsVisibility() {
  const shouldShow = state.activeTab === "manualFinance" || state.activeTab === "expenseAccounting" || state.activeTab === "savings" || state.activeTab === "orders";
  const display = shouldShow ? "" : "none";
  elements.connectGoogleButton.style.display = display;
  elements.disconnectGoogleButton.style.display = display;
}


// ============================================================
// GOOGLE OAUTH
// ============================================================

async function ensureGoogleAccess(interactive = true) {
  if (!state.googleAuth.configured) {
    throw new Error("Google OAuth client is not configured in sheet-config.json yet.");
  }
  if (!state.googleAuth.accessToken) {
    await connectGoogle(interactive);
  }
  if (!state.googleAuth.accessToken) {
    throw new Error("Google is not connected.");
  }
}


// ============================================================
// AUTH UI AND READINESS
// ============================================================

function getDashboardGoogleAccessMessage() {
  return "Google OAuth не нужен для серверных вкладок. Подключайте его только для fact и orders.";
}
