const state = {
  config: null,
  snapshotPayload: null,
  activeTab: "movement",
  loading: false,
  data: null,
  googleAuth: {
    clientId: "",
    scopes: "",
    tokenClient: null,
    accessToken: "",
    configured: false,
    initialized: false,
    initializing: false,
    readyError: ""
  },
  manualFinance: {
    loading: false,
    data: null,
    periods: [],
    dirty: false,
    status: "",
    error: false
  },
  expenseAccounting: {
    activeSubtab: "list",
    loading: false,
    paypalLoading: false,
    paypalSummary: null,
    wiseLoading: false,
    wiseSummary: null,
    tdBankLoading: false,
    tdBankSummary: null,
    entries: [],
    warnings: [],
    status: "",
    error: false
  },
  manualTransfers: {
    loading: false,
    data: null,
    dirty: false,
    status: "",
    error: false
  },
  manualOrders: {
    loading: false,
    data: null,
    dirty: false,
    status: "",
    error: false,
    textDraft: ""
  },
  analyticsFact: {
    periodStart: "",
    periodEnd: "",
    moneyTitle: "",
    moneyHeaders: [],
    moneyRows: []
  }
};

const elements = {
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  status: document.getElementById("status"),
  endpointLabel: document.getElementById("endpointLabel"),
  manualEndpointLabel: document.getElementById("manualEndpointLabel"),
  metricPeriod: document.getElementById("metricPeriod"),
  metricOrders: document.getElementById("metricOrders"),
  metricBalances: document.getElementById("metricBalances"),
  metricTransfers: document.getElementById("metricTransfers"),
  metricMyServices: document.getElementById("metricMyServices"),
  metricProfit: document.getElementById("metricProfit"),
  metricMyCosts: document.getElementById("metricMyCosts"),
  tabs: document.getElementById("tabs"),
  tabPanels: document.getElementById("tabPanels"),
  todayButton: document.getElementById("todayButton"),
  weekButton: document.getElementById("weekButton"),
  calculateButton: document.getElementById("calculateButton"),
  connectGoogleButton: document.getElementById("connectGoogleButton"),
  disconnectGoogleButton: document.getElementById("disconnectGoogleButton")
};
