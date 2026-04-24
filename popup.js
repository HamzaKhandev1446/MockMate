const MSG = {
  GET_STATE_FOR_ORIGIN: "GET_STATE_FOR_ORIGIN",
  SET_MODE_FOR_ORIGIN: "SET_MODE_FOR_ORIGIN",
  GET_SNAPSHOT: "GET_SNAPSHOT",
  TOGGLE_ENDPOINT: "TOGGLE_ENDPOINT",
  TOGGLE_ALL_ENDPOINTS: "TOGGLE_ALL_ENDPOINTS",
  CLEAR_SNAPSHOT: "CLEAR_SNAPSHOT",
  UPDATE_ENDPOINT: "UPDATE_ENDPOINT",
  ADD_ENDPOINT: "ADD_ENDPOINT",
  SET_GLOBAL_DELAY: "SET_GLOBAL_DELAY",
  LIST_SESSIONS: "LIST_SESSIONS",
  CREATE_SESSION: "CREATE_SESSION",
  SET_ACTIVE_SESSION: "SET_ACTIVE_SESSION",
  DELETE_SESSION: "DELETE_SESSION",
  RENAME_SESSION: "RENAME_SESSION",
  GET_EXTENSION_ENABLED: "GET_EXTENSION_ENABLED",
  SET_EXTENSION_ENABLED: "SET_EXTENSION_ENABLED",
};

const MODES = { REAL: "real", RECORD: "record", REPLAY: "replay" };
const THEME_KEY = "mockmate:theme";

let origin = "";
let activeTabId = null;
let snapshot = { endpoints: {} };
let selectedKey = "";
let currentMode = MODES.REAL;
let extensionEnabled = true;
let sessionStartedAt = Date.now();
let sessionInfo = { id: null, name: "" };

const $ = (id) => document.getElementById(id);

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (res) => resolve(res)));
}

async function getActiveOrigin() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tabs[0]?.id ?? null;
  const url = tabs[0]?.url || "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function setStatus(text) {
  $("status").textContent = text;
}

function splitShellArgs(command) {
  const args = [];
  let current = "";
  let quote = null;
  let escape = false;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

function parseCurlCommand(rawCurl) {
  const normalized = String(rawCurl || "")
    .replace(/\\\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) throw new Error("Paste a cURL command first.");

  const tokens = splitShellArgs(normalized);
  if (!tokens.length || tokens[0].toLowerCase() !== "curl") {
    throw new Error("Input does not look like a cURL command.");
  }

  let method = "GET";
  let url = "";
  let bodyRaw = "";
  const headers = {};

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if ((token === "-X" || token === "--request") && tokens[i + 1]) {
      method = tokens[i + 1].toUpperCase();
      i += 1;
      continue;
    }
    if ((token === "-H" || token === "--header") && tokens[i + 1]) {
      const rawHeader = tokens[i + 1];
      const idx = rawHeader.indexOf(":");
      if (idx > 0) {
        const key = rawHeader.slice(0, idx).trim().toLowerCase();
        const value = rawHeader.slice(idx + 1).trim();
        headers[key] = value;
      }
      i += 1;
      continue;
    }
    if (
      (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary") &&
      tokens[i + 1]
    ) {
      bodyRaw = tokens[i + 1];
      if (method === "GET") method = "POST";
      i += 1;
      continue;
    }
    if (!token.startsWith("-") && /^https?:\/\//i.test(token)) {
      url = token;
    }
  }

  if (!url) throw new Error("Could not find URL in cURL command.");

  let body = null;
  const contentType = (headers["content-type"] || "").toLowerCase();
  if (bodyRaw) {
    if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(bodyRaw);
      } catch {
        body = bodyRaw;
      }
    } else {
      body = bodyRaw;
    }
  }

  return { method, url, headers, body };
}

function applyCurlToQuickAdd(parsed) {
  $("quickAddMethod").value = parsed.method || "GET";
  $("quickAddUrl").value = parsed.url || "";
  $("quickAddHeaders").value = JSON.stringify(parsed.headers || {}, null, 2);
  $("quickAddBody").value = JSON.stringify(parsed.body ?? null, null, 2);
  $("quickAddStatus").value = "200";
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function updateSessionVisual() {
  const endpoints = snapshot?.endpoints || {};
  const total = Object.keys(endpoints).length;
  const enabled = Object.values(endpoints).filter((ep) => ep?.enabled !== false).length;
  const elapsedMs = Date.now() - sessionStartedAt;

  $("capturedCount").textContent = String(total);
  $("enabledCount").textContent = String(enabled);
  $("totalCount").textContent = String(total);
  $("sessionElapsed").textContent = formatElapsed(elapsedMs);

  const visual = $("sessionVisual");
  visual.classList.remove("mode-real-visual", "mode-record-visual", "mode-replay-visual");

  if (currentMode === MODES.RECORD) {
    visual.classList.add("mode-record-visual");
    $("sessionTitle").textContent = "Recording Session Active";
    $("sessionSubtitle").textContent = `Recording ON. Keep navigating; APIs are captured until you switch mode. Session: ${sessionInfo.name || "Unnamed"}`;
  } else if (currentMode === MODES.REPLAY) {
    visual.classList.add("mode-replay-visual");
    $("sessionTitle").textContent = "Replay Session Active";
    $("sessionSubtitle").textContent = `Replay ON. Mock APIs are being served from session: ${sessionInfo.name || "Unnamed"}`;
  } else {
    visual.classList.add("mode-real-visual");
    $("sessionTitle").textContent = "Real Mode";
    $("sessionSubtitle").textContent = "No interception. APIs hit the real backend.";
  }
}

function applyTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  const button = $("themeToggle");

  document.documentElement.setAttribute("data-theme", normalized);
  localStorage.setItem(THEME_KEY, normalized);

  if (button) {
    button.setAttribute("data-theme-state", normalized === "light" ? "dark" : "light");
    if (normalized === "light") {
      button.title = "Switch to Night mode";
      button.setAttribute("aria-label", "Switch to Night mode");
    } else {
      button.title = "Switch to Day mode";
      button.setAttribute("aria-label", "Switch to Day mode");
    }
  }
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(savedTheme);
}

function setModeVisual(mode) {
  ["realBtn", "recordBtn", "replayBtn"].forEach((id) => $(id).classList.remove("active"));
  if (mode === MODES.REAL) $("realBtn").classList.add("active");
  if (mode === MODES.RECORD) $("recordBtn").classList.add("active");
  if (mode === MODES.REPLAY) $("replayBtn").classList.add("active");
  currentMode = mode;
}

function applyExtensionToggle(enabled) {
  extensionEnabled = Boolean(enabled);
  const toggle = $("extensionToggle");
  toggle.className = `toggle-switch ${extensionEnabled ? "is-on" : "is-off"}`;
  toggle.setAttribute("aria-checked", String(extensionEnabled));
  toggle.title = extensionEnabled ? "Turn extension OFF" : "Turn extension ON";
  ["realBtn", "recordBtn", "replayBtn"].forEach((id) => {
    const button = $(id);
    button.disabled = !extensionEnabled;
    button.style.opacity = extensionEnabled ? "1" : "0.55";
    button.title = extensionEnabled ? "" : "Enable extension to switch mode";
  });
}

async function refreshState() {
  const state = await send({ type: MSG.GET_STATE_FOR_ORIGIN, origin, tabId: activeTabId });
  if (!state?.ok) return;
  const wasMode = currentMode;
  $("origin").textContent = origin || "-";
  $("delay").value = state.delayMs;
  $("delayValue").value = state.delayMs;
  applyExtensionToggle(state.extensionEnabled !== false);
  setModeVisual(state.mode);
  sessionInfo = { id: state.activeSessionId || null, name: state.activeSessionName || "" };
  if (wasMode !== state.mode) {
    sessionStartedAt = Date.now();
  }
  updateSessionVisual();
}

async function refreshSessions() {
  const res = await send({ type: MSG.LIST_SESSIONS, tabId: activeTabId });
  const select = $("sessionSelect");
  select.innerHTML = "";
  if (!res?.ok) return;
  const sessions = res.sessions || [];
  const draftOption = document.createElement("option");
  draftOption.value = "";
  draftOption.textContent = "Unsaved Draft";
  select.appendChild(draftOption);
  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = `${session.name} (${session.endpointCount})`;
    select.appendChild(option);
  }
  const activeId = sessionInfo.id || res.activeSessionId;
  if (activeId && sessions.some((s) => s.id === activeId)) {
    select.value = activeId;
  } else {
    select.value = "";
  }
}

async function refreshSnapshot() {
  const res = await send({ type: MSG.GET_SNAPSHOT, origin, tabId: activeTabId });
  if (!res?.ok) return;
  snapshot = res.snapshot || { endpoints: {} };
  sessionInfo = {
    id: res.snapshot?.isDraft ? null : (res.snapshot?.sessionId || sessionInfo.id || null),
    name: res.snapshot?.sessionName || (res.snapshot?.isDraft ? "Unsaved Draft" : (sessionInfo.name || "")),
  };
  const currentSelect = $("sessionSelect");
  if (currentSelect) {
    currentSelect.value = sessionInfo.id || "";
  }
  renderApiList();
  updateSessionVisual();
}

function renderApiList() {
  const filter = $("search").value.trim().toLowerCase();
  const list = $("apiList");
  list.innerHTML = "";
  const allEntries = Object.entries(snapshot.endpoints || {});
  const entries = allEntries.filter(([k]) => k.toLowerCase().includes(filter));
  const allEnabled = allEntries.length > 0 && allEntries.every(([, v]) => v?.enabled !== false);
  const toggleAllBtn = $("toggleAllBtn");
  toggleAllBtn.className = `toggle-switch ${allEnabled ? "is-on" : "is-off"}`;
  toggleAllBtn.setAttribute("aria-checked", String(allEnabled));
  toggleAllBtn.title = allEnabled ? "Turn OFF all mocked APIs" : "Turn ON all mocked APIs";
  for (const [key, value] of entries) {
    const row = document.createElement("div");
    row.className = "item";
    const left = document.createElement("div");
    left.className = "key";
    left.textContent = key;
    left.title = key;
    left.onclick = () => selectApi(key);

    const enabled = value.enabled !== false;
    const right = document.createElement("button");
    right.type = "button";
    right.className = `toggle-switch ${enabled ? "is-on" : "is-off"}`;
    right.setAttribute("role", "switch");
    right.setAttribute("aria-checked", String(enabled));
    right.innerHTML = `
      <span class="toggle-label toggle-label-off">OFF</span>
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
      <span class="toggle-label toggle-label-on">ON</span>
    `;
    right.title = enabled ? "Turn OFF mock for this API" : "Turn ON mock for this API";
    right.onclick = async () => {
      await send({ type: MSG.TOGGLE_ENDPOINT, origin, tabId: activeTabId, key, enabled: !enabled });
      await refreshSnapshot();
    };
    row.append(left, right);
    list.appendChild(row);
  }
}

function selectApi(key) {
  selectedKey = key;
  const ep = snapshot.endpoints[key];
  $("selectedKey").textContent = key;
  $("selectedKey").title = key;
  $("statusInput").value = ep?.status ?? 200;
  $("headersInput").value = JSON.stringify(ep?.headers || {}, null, 2);
  $("bodyInput").value = JSON.stringify(ep?.body ?? null, null, 2);
}

async function saveSelectedApi() {
  if (!selectedKey) return;
  let headers;
  let body;
  try {
    headers = JSON.parse($("headersInput").value || "{}");
    body = JSON.parse($("bodyInput").value || "null");
  } catch {
    setStatus("Invalid JSON in headers/body");
    return;
  }
  const status = Number($("statusInput").value || 200);
  await send({
    type: MSG.UPDATE_ENDPOINT,
    origin,
    tabId: activeTabId,
    key: selectedKey,
    patch: { status, headers, body },
  });
  await refreshSnapshot();
  setStatus("Saved API changes");
}

function bind() {
  $("themeToggle").onclick = () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  };
  $("extensionToggle").onclick = async () => {
    const res = await send({ type: MSG.SET_EXTENSION_ENABLED, enabled: !extensionEnabled });
    if (!res?.ok) {
      setStatus("Failed to update extension state");
      return;
    }
    await refreshState();
    await refreshSnapshot();
    setStatus(res.extensionEnabled ? "Extension enabled" : "Extension disabled");
  };

  $("search").addEventListener("input", renderApiList);
  $("toggleAllBtn").onclick = async () => {
    const allEntries = Object.entries(snapshot.endpoints || {});
    if (!allEntries.length) {
      setStatus("No APIs in current session");
      return;
    }
    const allEnabled = allEntries.every(([, v]) => v?.enabled !== false);
    const targetEnabled = !allEnabled;
    await send({
      type: MSG.TOGGLE_ALL_ENDPOINTS,
      origin,
      tabId: activeTabId,
      enabled: targetEnabled,
    });
    await refreshSnapshot();
    setStatus(targetEnabled ? "All APIs turned ON" : "All APIs turned OFF");
  };
  $("saveApiBtn").onclick = saveSelectedApi;
  $("discardApiBtn").onclick = () => selectedKey && selectApi(selectedKey);

  $("realBtn").onclick = () => setMode(MODES.REAL);
  $("recordBtn").onclick = () => setMode(MODES.RECORD);
  $("replayBtn").onclick = () => setMode(MODES.REPLAY);

  $("sessionSelect").onchange = async () => {
    const sessionId = $("sessionSelect").value;
    if (currentMode === MODES.RECORD) {
      await setMode(MODES.REAL);
      setStatus("Recording stopped before switching session");
    }
    await send({ type: MSG.SET_ACTIVE_SESSION, tabId: activeTabId, sessionId });
    await refreshState();
    await refreshSnapshot();
    setStatus("Active session switched");
  };

  const saveDraftAsSession = async () => {
    const defaultName = `${origin.replace(/^https?:\/\//, "")} ${new Date().toLocaleString()}`;
    const name = prompt("Session name", defaultName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("Session name cannot be empty");
      return;
    }
    await send({ type: MSG.CREATE_SESSION, tabId: activeTabId, origin, name: trimmed });
    await refreshState();
    await refreshSessions();
    await refreshSnapshot();
    setStatus("Draft saved as session");
  };
  $("saveDraftBtn").onclick = saveDraftAsSession;
  $("newSessionBtn").onclick = saveDraftAsSession;

  $("renameSessionBtn").onclick = async () => {
    const sessionId = $("sessionSelect").value;
    if (!sessionId) {
      setStatus("No session selected");
      return;
    }
    const currentName = $("sessionSelect").selectedOptions?.[0]?.textContent?.replace(/\s\(\d+\)\s*$/, "") || "";
    const name = prompt("Rename session", currentName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("Session name cannot be empty");
      return;
    }
    const res = await send({ type: MSG.RENAME_SESSION, sessionId, name: trimmed });
    if (!res?.ok) {
      setStatus(`Rename failed: ${res?.error || "Unknown error"}`);
      return;
    }
    await refreshState();
    await refreshSessions();
    setStatus("Session renamed");
  };

  $("deleteSessionBtn").onclick = async () => {
    const sessionId = $("sessionSelect").value;
    if (!sessionId) {
      setStatus("No session selected");
      return;
    }
    const sessionLabel = $("sessionSelect").selectedOptions?.[0]?.textContent || "selected session";
    if (!confirm(`Delete session "${sessionLabel}"?`)) return;
    const res = await send({ type: MSG.DELETE_SESSION, tabId: activeTabId, origin, sessionId });
    if (!res?.ok) {
      setStatus(`Delete failed: ${res?.error || "Unknown error"}`);
      return;
    }
    await refreshState();
    await refreshSessions();
    await refreshSnapshot();
    setStatus("Session deleted");
  };

  $("clearBtn").onclick = async () => {
    if (!confirm("Clear all mocked APIs for this origin?")) return;
    await send({ type: MSG.CLEAR_SNAPSHOT, origin, tabId: activeTabId });
    selectedKey = "";
    $("selectedKey").textContent = "None";
    await refreshSnapshot();
  };

  $("saveBtn").onclick = refreshSnapshot;

  $("quickAddCurlBtn").onclick = () => {
    try {
      const parsed = parseCurlCommand($("quickAddCurl").value);
      applyCurlToQuickAdd(parsed);
      setStatus("cURL imported. Review fields and click Add API.");
    } catch (error) {
      setStatus(`cURL import failed: ${error?.message || "Unknown error"}`);
    }
  };

  $("quickAddBtn").onclick = async () => {
    const method = $("quickAddMethod").value;
    const url = $("quickAddUrl").value.trim();
    const status = Number($("quickAddStatus").value || 200);
    if (!url) {
      setStatus("Quick Add: URL is required");
      return;
    }
    let headers = {};
    let body = null;
    try {
      const headersText = $("quickAddHeaders").value.trim();
      const bodyText = $("quickAddBody").value.trim();
      headers = headersText ? JSON.parse(headersText) : {};
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      setStatus("Quick Add: invalid JSON in headers/body");
      return;
    }
    const res = await send({
      type: MSG.ADD_ENDPOINT,
      origin,
      tabId: activeTabId,
      payload: { method, url, status, headers, body },
    });
    if (!res?.ok) {
      setStatus(`Quick Add failed: ${res?.error || "Unknown error"}`);
      return;
    }
    $("quickAddUrl").value = "";
    setStatus("Quick Add: API inserted into active session");
    await refreshSnapshot();
  };

  const saveDelay = async (value) => {
    const n = Math.min(60000, Math.max(0, Number(value || 0)));
    $("delay").value = String(n);
    $("delayValue").value = String(n);
    await send({ type: MSG.SET_GLOBAL_DELAY, origin, delayMs: n });
    setStatus(`Global delay set to ${n}ms`);
  };
  $("delay").oninput = (e) => saveDelay(e.target.value);
  $("delayValue").onchange = (e) => saveDelay(e.target.value);

  document.addEventListener("keydown", async (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      $("search").focus();
      return;
    }
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      await saveSelectedApi();
      return;
    }
    if (e.key === "1") {
      e.preventDefault();
      await setMode(MODES.REAL);
      return;
    }
    if (e.key === "2") {
      e.preventDefault();
      await setMode(MODES.RECORD);
      return;
    }
    if (e.key === "3") {
      e.preventDefault();
      await setMode(MODES.REPLAY);
    }
  });

  setInterval(updateSessionVisual, 1000);
}

async function setMode(mode) {
  const res = await send({ type: MSG.SET_MODE_FOR_ORIGIN, origin, tabId: activeTabId, mode });
  await refreshState();
  await refreshSessions();
  await refreshSnapshot();
}

(async function init() {
  bind();
  initializeTheme();
  origin = await getActiveOrigin();
  if (!origin) {
    setStatus("Open a web tab to use MockMate.");
    return;
  }
  await refreshState();
  await refreshSessions();
  await refreshSnapshot();
})();
