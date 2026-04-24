const MODES = { REAL: "real", RECORD: "record", REPLAY: "replay" };

const MSG = {
  GET_STATE_FOR_ORIGIN: "GET_STATE_FOR_ORIGIN",
  SET_MODE_FOR_ORIGIN: "SET_MODE_FOR_ORIGIN",
  RECORD_CAPTURE: "RECORD_CAPTURE",
  GET_SNAPSHOT: "GET_SNAPSHOT",
  TOGGLE_ENDPOINT: "TOGGLE_ENDPOINT",
  TOGGLE_ALL_ENDPOINTS: "TOGGLE_ALL_ENDPOINTS",
  CLEAR_SNAPSHOT: "CLEAR_SNAPSHOT",
  UPDATE_ENDPOINT: "UPDATE_ENDPOINT",
  SET_GLOBAL_DELAY: "SET_GLOBAL_DELAY",
  GET_GLOBAL_DELAY: "GET_GLOBAL_DELAY",
  GET_ENDPOINT_FOR_REQUEST: "GET_ENDPOINT_FOR_REQUEST",
  ADD_ENDPOINT: "ADD_ENDPOINT",
  FETCH_ENDPOINT_RESPONSE: "FETCH_ENDPOINT_RESPONSE",
  LIST_SESSIONS: "LIST_SESSIONS",
  CREATE_SESSION: "CREATE_SESSION",
  SET_ACTIVE_SESSION: "SET_ACTIVE_SESSION",
  DELETE_SESSION: "DELETE_SESSION",
  RENAME_SESSION: "RENAME_SESSION",
  GET_EXTENSION_ENABLED: "GET_EXTENSION_ENABLED",
  SET_EXTENSION_ENABLED: "SET_EXTENSION_ENABLED",
};

const modeKey = (origin) => `mode::${origin}`;
const delayKey = (origin) => `delay::${origin}`;
const tabModeKey = (tabId) => `tabMode::${tabId}`;
const tabActiveSessionKey = (tabId) => `tabActiveSession::${tabId}`;
const tabDraftKey = (tabId) => `tabDraft::${tabId}`;
const EXTENSION_ENABLED_KEY = "extensionEnabled";
const CONTEXT_MENU_ADD = "mockmate-add-endpoint";

async function getExtensionEnabled() {
  const data = await chrome.storage.local.get(EXTENSION_ENABLED_KEY);
  return data[EXTENSION_ENABLED_KEY] !== false;
}

async function setExtensionEnabled(enabled) {
  await chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: Boolean(enabled) });
}

async function getMode(origin) {
  const data = await chrome.storage.local.get(modeKey(origin));
  return data[modeKey(origin)] || MODES.REAL;
}

async function setMode(origin, mode) {
  await chrome.storage.local.set({ [modeKey(origin)]: mode });
}

async function getTabMode(tabId) {
  if (!tabId) return null;
  const data = await chrome.storage.local.get(tabModeKey(tabId));
  return data[tabModeKey(tabId)] || null;
}

async function setTabMode(tabId, mode) {
  if (!tabId) return;
  await chrome.storage.local.set({ [tabModeKey(tabId)]: mode });
}

async function getDelay(origin) {
  const data = await chrome.storage.local.get(delayKey(origin));
  const v = Number(data[delayKey(origin)] ?? 0);
  if (Number.isNaN(v)) return 0;
  return Math.min(60000, Math.max(0, v));
}

async function setDelay(origin, delayMs) {
  const v = Number(delayMs || 0);
  const clamped = Number.isNaN(v) ? 0 : Math.min(60000, Math.max(0, v));
  await chrome.storage.local.set({ [delayKey(origin)]: clamped });
  return clamped;
}

function endpointKey(method, url) {
  return `${String(method || "GET").toUpperCase()}::${url}`;
}

function normalizeUrlVariants(rawUrl) {
  const variants = new Set();
  if (!rawUrl) return [];
  const methodSafe = String(rawUrl).trim();
  variants.add(methodSafe);
  try {
    const u = new URL(methodSafe);
    const originPath = `${u.origin}${u.pathname}`;
    const pathOnly = u.pathname;
    const originPathNoSlash = originPath.replace(/\/+$/, "");
    const pathOnlyNoSlash = pathOnly.replace(/\/+$/, "");
    variants.add(originPath);
    variants.add(pathOnly);
    variants.add(originPathNoSlash);
    variants.add(pathOnlyNoSlash);
  } catch {
    // Keep raw when URL constructor fails.
  }
  return [...variants].filter(Boolean);
}

function defaultSessionName(seed = "session") {
  const safeSeed = String(seed || "session").replace(/^https?:\/\//, "");
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  return `${safeSeed} ${stamp}`;
}

async function getSessionsMap() {
  const data = await chrome.storage.local.get("sessions");
  return data.sessions || {};
}

async function saveSessionsMap(sessions) {
  await chrome.storage.local.set({ sessions });
}

function createEmptySession(name, appOrigin = "") {
  const id = `session_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const now = Date.now();
  return {
    id,
    name: name || defaultSessionName(appOrigin || "session"),
    endpoints: {},
    meta: {
      createdAt: now,
      updatedAt: now,
      appOrigin,
      version: 1,
      type: "named-session",
    },
  };
}

async function ensureSession(sessionName, appOrigin = "") {
  const sessions = await getSessionsMap();
  const created = createEmptySession(sessionName, appOrigin);
  sessions[created.id] = created;
  await saveSessionsMap(sessions);
  return created;
}

async function getTabActiveSessionId(tabId) {
  if (!tabId) return null;
  const data = await chrome.storage.local.get(tabActiveSessionKey(tabId));
  return data[tabActiveSessionKey(tabId)] || null;
}

async function setTabActiveSessionId(tabId, sessionId) {
  if (!tabId) return;
  if (!sessionId) {
    await chrome.storage.local.remove(tabActiveSessionKey(tabId));
    return;
  }
  await chrome.storage.local.set({ [tabActiveSessionKey(tabId)]: sessionId });
}

async function getTabDraft(tabId, appOrigin = "") {
  if (!tabId) return null;
  const data = await chrome.storage.local.get(tabDraftKey(tabId));
  const existing = data[tabDraftKey(tabId)];
  if (existing && typeof existing === "object") return existing;
  return {
    id: `draft-${tabId}`,
    name: "Unsaved Draft",
    endpoints: {},
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      appOrigin: appOrigin || "",
      isDraft: true,
    },
  };
}

async function setTabDraft(tabId, draft) {
  if (!tabId) return;
  await chrome.storage.local.set({ [tabDraftKey(tabId)]: draft });
}

async function clearTabDraft(tabId) {
  if (!tabId) return;
  await chrome.storage.local.remove(tabDraftKey(tabId));
}

async function getWorkingStore(tabId, appOrigin = "") {
  if (!tabId) {
    return {
      kind: "draft",
      id: "draft-no-tab",
      data: {
        id: "draft-no-tab",
        name: "Unsaved Draft",
        endpoints: {},
        meta: { appOrigin: appOrigin || "", isDraft: true, createdAt: Date.now(), updatedAt: Date.now() },
      },
    };
  }
  const sessions = await getSessionsMap();
  const activeId = await getTabActiveSessionId(tabId);
  if (activeId && sessions[activeId]) {
    return { kind: "session", id: activeId, data: sessions[activeId] };
  }
  const draft = await getTabDraft(tabId, appOrigin);
  return { kind: "draft", id: draft.id, data: draft };
}

async function patchWorkingStore(tabId, appOrigin, patcher) {
  const store = await getWorkingStore(tabId, appOrigin);
  if (store.kind === "session") {
    return patchSession(store.id, patcher);
  }
  const draft = store.data || (await getTabDraft(tabId, appOrigin));
  patcher(draft);
  draft.meta = draft.meta || {};
  draft.meta.updatedAt = Date.now();
  if (!draft.meta.appOrigin && appOrigin) draft.meta.appOrigin = appOrigin;
  await setTabDraft(tabId, draft);
  return draft;
}

async function getSnapshotForTab(tabId, appOrigin = "") {
  const store = await getWorkingStore(tabId, appOrigin);
  const active = store.data;
  return {
    endpoints: active.endpoints || {},
    meta: active.meta || {},
    sessionId: store.kind === "session" ? active.id : null,
    sessionName: active.name,
    isDraft: store.kind === "draft",
  };
}

async function patchSession(sessionId, patcher) {
  const sessions = await getSessionsMap();
  const session = sessions[sessionId];
  if (!session) return null;
  patcher(session);
  session.meta = session.meta || {};
  session.meta.updatedAt = Date.now();
  sessions[sessionId] = session;
  await saveSessionsMap(sessions);
  return session;
}

async function upsertCaptured(tabId, origin, payload) {
  const key = endpointKey(payload.method, payload.url);
  const endpoint = {
    status: payload.status,
    headers: payload.headers || {},
    body: payload.body ?? null,
    contentType: payload.contentType || "application/json",
    timestamp: Date.now(),
    enabled: true,
  };
  await patchWorkingStore(tabId, origin, (session) => {
    session.endpoints = session.endpoints || {};
    session.endpoints[key] = endpoint;
    if (!session.meta?.appOrigin) {
      session.meta = session.meta || {};
      session.meta.appOrigin = origin;
    }
  });
}

async function addEndpointToActiveSession(tabId, origin, payload) {
  const method = String(payload?.method || "GET").toUpperCase();
  const url = String(payload?.url || "").trim();
  if (!url) return { ok: false, error: "URL is required" };
  const key = endpointKey(method, url);
  const status = Number(payload?.status || 200);
  const headers = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
  const body = payload?.body ?? null;
  await patchWorkingStore(tabId, origin, (session) => {
    session.endpoints = session.endpoints || {};
    session.endpoints[key] = {
      status: Number.isFinite(status) ? status : 200,
      headers,
      body,
      contentType: headers["content-type"] || headers["Content-Type"] || "application/json",
      timestamp: Date.now(),
      enabled: true,
    };
  });
  return { ok: true, key };
}

async function fetchEndpointResponse(payload) {
  const method = String(payload?.method || "GET").toUpperCase();
  const url = String(payload?.url || "").trim();
  if (!url) return { ok: false, error: "URL is required" };
  const headers = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
  const requestBody = payload?.body;

  const init = {
    method,
    headers,
    credentials: "include",
  };
  if (!["GET", "HEAD"].includes(method) && requestBody !== undefined && requestBody !== null) {
    init.body = typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody);
  }

  const res = await fetch(url, init);
  const contentType = res.headers.get("content-type") || "";
  let body = null;
  if (contentType.includes("application/json")) {
    try {
      body = await res.clone().json();
    } catch {
      body = await res.text();
    }
  } else {
    body = await res.text();
  }
  return {
    ok: true,
    response: {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      contentType: contentType || "application/json",
    },
  };
}

async function clearActiveSession(tabId, origin) {
  await patchWorkingStore(tabId, origin, (session) => {
    session.endpoints = {};
    session.meta = session.meta || {};
    if (!session.meta.createdAt) session.meta.createdAt = Date.now();
  });
}

async function setActiveSession(tabId, sessionId) {
  if (!tabId) return false;
  if (!sessionId) {
    await setTabActiveSessionId(tabId, null);
    return true;
  }
  const sessions = await getSessionsMap();
  if (!sessions[sessionId]) return false;
  await setTabActiveSessionId(tabId, sessionId);
  return true;
}

async function deleteSession(tabId, sessionId, fallbackOrigin = "") {
  const sessions = await getSessionsMap();
  if (!sessions[sessionId]) return { ok: false, error: "Session not found" };
  delete sessions[sessionId];
  await saveSessionsMap(sessions);

  const activeId = await getTabActiveSessionId(tabId);
  if (activeId === sessionId) {
    const nextSession = Object.values(sessions).sort((a, b) => (b.meta?.updatedAt || 0) - (a.meta?.updatedAt || 0))[0];
    if (nextSession?.id) {
      await setTabActiveSessionId(tabId, nextSession.id);
    } else {
      await setTabActiveSessionId(tabId, null);
      const draft = await getTabDraft(tabId, fallbackOrigin || "");
      if (!draft.meta?.appOrigin && fallbackOrigin) {
        draft.meta = draft.meta || {};
        draft.meta.appOrigin = fallbackOrigin;
      }
      await setTabDraft(tabId, draft);
    }
  }
  return { ok: true };
}

async function renameSession(sessionId, newName) {
  const name = String(newName || "").trim();
  if (!name) return { ok: false, error: "Session name is required" };
  const sessions = await getSessionsMap();
  if (!sessions[sessionId]) return { ok: false, error: "Session not found" };
  sessions[sessionId].name = name;
  sessions[sessionId].meta = sessions[sessionId].meta || {};
  sessions[sessionId].meta.updatedAt = Date.now();
  await saveSessionsMap(sessions);
  return { ok: true };
}

async function listSessions() {
  const sessions = await getSessionsMap();
  return Object.values(sessions)
    .sort((a, b) => (b.meta?.updatedAt || 0) - (a.meta?.updatedAt || 0))
    .map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.meta?.createdAt || 0,
      updatedAt: s.meta?.updatedAt || 0,
      endpointCount: Object.keys(s.endpoints || {}).length,
      appOrigin: s.meta?.appOrigin || "",
    }));
}

function parseContextSelection(rawText = "") {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const methodUrlMatch = text.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b\s+(https?:\/\/[^\s"']+)/i);
  if (methodUrlMatch) {
    return { method: methodUrlMatch[1].toUpperCase(), url: methodUrlMatch[2] };
  }
  const curlMatch = text.match(/curl(?:\s+-X\s+([A-Z]+))?.*?(https?:\/\/[^\s"']+)/i);
  if (curlMatch) {
    return { method: (curlMatch[1] || "GET").toUpperCase(), url: curlMatch[2] };
  }
  const urlOnly = text.match(/https?:\/\/[^\s"']+/i);
  if (urlOnly) {
    return { method: "GET", url: urlOnly[0] };
  }
  return null;
}

function extractContextEndpoint(info, tab) {
  if (info.linkUrl) return { method: "GET", url: info.linkUrl };
  const parsedSelection = parseContextSelection(info.selectionText);
  if (parsedSelection) return parsedSelection;
  if (tab?.url) return { method: "GET", url: tab.url };
  return null;
}

async function createContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ADD,
    title: "Add to MockMate",
    contexts: ["selection", "link", "page"],
    documentUrlPatterns: ["<all_urls>"],
  });
}

async function getResolvedMode(origin, tabId) {
  const tabMode = await getTabMode(tabId);
  if (tabMode && [MODES.REAL, MODES.RECORD, MODES.REPLAY].includes(tabMode)) {
    return tabMode;
  }
  // Do not infer mode from origin history. Tab mode is explicit to avoid
  // accidental auto-switch (e.g. old replay config on a redirected URL).
  return MODES.REAL;
}

async function getEndpointForRequest(tabId, origin, method, url) {
  const store = await getWorkingStore(tabId, origin);
  const active = store.data;
  const m = String(method || "GET").toUpperCase();
  const endpoints = active.endpoints || {};
  const keys = normalizeUrlVariants(url).map((u) => endpointKey(m, u));

  // 1) exact and normalized deterministic candidates first.
  for (const key of keys) {
    const endpoint = endpoints[key];
    if (endpoint && endpoint.enabled !== false) {
      return { key, endpoint };
    }
  }

  // 2) fallback: match by same METHOD + same pathname (ignoring host/query),
  // choose the most recently captured endpoint to improve hit rate.
  let targetPath = "";
  try {
    targetPath = new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    targetPath = String(url || "").replace(/\?.*$/, "").replace(/\/+$/, "");
  }

  let best = null;
  for (const [key, endpoint] of Object.entries(endpoints)) {
    if (!endpoint || endpoint.enabled === false) continue;
    const [savedMethod, savedUrl] = key.split("::");
    if (savedMethod !== m) continue;
    let savedPath = "";
    try {
      savedPath = new URL(savedUrl).pathname.replace(/\/+$/, "");
    } catch {
      savedPath = String(savedUrl || "").replace(/\?.*$/, "").replace(/\/+$/, "");
    }
    if (savedPath !== targetPath) continue;
    const ts = Number(endpoint.timestamp || 0);
    if (!best || ts > Number(best.endpoint.timestamp || 0)) {
      best = { key, endpoint };
    }
  }

  if (best) {
    return best;
  }

  // 3) broader fallback: same pathname across methods.
  // Helps when clients change method unexpectedly (or metadata differs),
  // while still scoping by path and most recent endpoint.
  for (const [key, endpoint] of Object.entries(endpoints)) {
    if (!endpoint || endpoint.enabled === false) continue;
    const [, savedUrl] = key.split("::");
    let savedPath = "";
    try {
      savedPath = new URL(savedUrl).pathname.replace(/\/+$/, "");
    } catch {
      savedPath = String(savedUrl || "").replace(/\?.*$/, "").replace(/\/+$/, "");
    }
    if (savedPath !== targetPath) continue;
    const ts = Number(endpoint.timestamp || 0);
    if (!best || ts > Number(best.endpoint.timestamp || 0)) {
      best = { key, endpoint };
    }
  }

  if (best) {
    return best;
  }
  return null;
}

async function syncTabsForOrigin(origin) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    try {
      if (new URL(tab.url).origin === origin) {
        chrome.tabs.sendMessage(tab.id, { type: "SYNC_STATE_TO_PAGE" }, () => void chrome.runtime.lastError);
      }
    } catch {
      // no-op
    }
  }
}

function setBadge(tabId, mode) {
  if (!tabId) return;
  if (mode === MODES.RECORD) {
    chrome.action.setBadgeText({ tabId, text: "REC" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#d73a49" });
  } else if (mode === MODES.REPLAY) {
    chrome.action.setBadgeText({ tabId, text: "ON" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#c69026" });
  } else {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;
  try {
    const extensionEnabled = await getExtensionEnabled();
    if (!extensionEnabled) {
      setBadge(tabId, MODES.REAL);
      return;
    }
    const origin = new URL(tab.url).origin;
    const mode = await getResolvedMode(origin, tabId);
    setBadge(tabId, mode || MODES.REAL);
  } catch {
    setBadge(tabId, MODES.REAL);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const origin = message?.origin;
    switch (message?.type) {
      case MSG.GET_STATE_FOR_ORIGIN: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const mode = await getResolvedMode(origin, tabId);
        const delayMs = await getDelay(origin);
        const extensionEnabled = await getExtensionEnabled();
        const activeSessionId = await getTabActiveSessionId(tabId);
        const sessions = await getSessionsMap();
        const activeSession = activeSessionId ? sessions[activeSessionId] : null;
        const resolvedMode = extensionEnabled ? (mode || MODES.REAL) : MODES.REAL;
        setBadge(tabId, resolvedMode);
        sendResponse({
          ok: true,
          mode: resolvedMode,
          delayMs,
          extensionEnabled,
          activeSessionId: activeSession?.id || null,
          activeSessionName: activeSession?.name || "",
        });
        return;
      }
      case MSG.SET_MODE_FOR_ORIGIN: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const extensionEnabled = await getExtensionEnabled();
        const requested = message.mode;
        const mode = extensionEnabled && [MODES.REAL, MODES.RECORD, MODES.REPLAY].includes(requested) ? requested : MODES.REAL;
        await setTabMode(tabId, mode);
        await setMode(origin, mode);
        setBadge(tabId, mode);
        await syncTabsForOrigin(origin);
        sendResponse({ ok: true, mode });
        return;
      }
      case MSG.RECORD_CAPTURE: {
        const extensionEnabled = await getExtensionEnabled();
        if (!extensionEnabled) {
          sendResponse({ ok: true });
          return;
        }
        const tabId = sender?.tab?.id ?? message?.tabId;
        await upsertCaptured(tabId, origin, message.payload);
        sendResponse({ ok: true });
        return;
      }
      case MSG.GET_SNAPSHOT: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const snapshot = await getSnapshotForTab(tabId, origin);
        sendResponse({ ok: true, snapshot });
        return;
      }
      case MSG.CLEAR_SNAPSHOT: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        await clearActiveSession(tabId, origin);
        sendResponse({ ok: true });
        return;
      }
      case MSG.TOGGLE_ENDPOINT: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        await patchWorkingStore(tabId, origin, (session) => {
          const endpoint = session.endpoints?.[message.key];
          if (endpoint) endpoint.enabled = Boolean(message.enabled);
        });
        sendResponse({ ok: true });
        return;
      }
      case MSG.TOGGLE_ALL_ENDPOINTS: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const enabled = Boolean(message.enabled);
        await patchWorkingStore(tabId, origin, (session) => {
          session.endpoints = session.endpoints || {};
          for (const key of Object.keys(session.endpoints)) {
            session.endpoints[key].enabled = enabled;
          }
        });
        sendResponse({ ok: true });
        return;
      }
      case MSG.UPDATE_ENDPOINT: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const store = await getWorkingStore(tabId, origin);
        if (!store.data?.endpoints?.[message.key]) {
          sendResponse({ ok: false, error: "Endpoint not found" });
          return;
        }
        await patchWorkingStore(tabId, origin, (session) => {
          session.endpoints[message.key] = {
            ...session.endpoints[message.key],
            ...message.patch,
            timestamp: Date.now(),
          };
        });
        sendResponse({ ok: true });
        return;
      }
      case MSG.ADD_ENDPOINT: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const result = await addEndpointToActiveSession(tabId, origin, message?.payload || {});
        sendResponse(result);
        return;
      }
      case MSG.FETCH_ENDPOINT_RESPONSE: {
        const result = await fetchEndpointResponse(message?.payload || {});
        sendResponse(result);
        return;
      }
      case MSG.SET_GLOBAL_DELAY: {
        const delayMs = await setDelay(origin, message.delayMs);
        await syncTabsForOrigin(origin);
        sendResponse({ ok: true, delayMs });
        return;
      }
      case MSG.GET_GLOBAL_DELAY: {
        const delayMs = await getDelay(origin);
        sendResponse({ ok: true, delayMs });
        return;
      }
      case MSG.GET_ENDPOINT_FOR_REQUEST: {
        const extensionEnabled = await getExtensionEnabled();
        if (!extensionEnabled) {
          sendResponse({ ok: true, mocked: false });
          return;
        }
        const tabId = sender?.tab?.id ?? message?.tabId;
        const mode = await getResolvedMode(origin, tabId);
        const canReplay = mode === MODES.REPLAY;
        if (!canReplay) {
          sendResponse({ ok: true, mocked: false });
          return;
        }
        const hit = await getEndpointForRequest(tabId, origin, message.method, message.url);
        if (!hit) {
          sendResponse({ ok: true, mocked: false });
          return;
        }
        const delayMs = await getDelay(origin);
        sendResponse({ ok: true, mocked: true, key: hit.key, endpoint: hit.endpoint, delayMs });
        return;
      }
      case MSG.LIST_SESSIONS: {
        const sessions = await listSessions();
        const tabId = message?.tabId ?? sender?.tab?.id;
        const activeSessionId = await getTabActiveSessionId(tabId);
        sendResponse({ ok: true, sessions, activeSessionId });
        return;
      }
      case MSG.CREATE_SESSION: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const name = String(message?.name || "").trim() || defaultSessionName(origin || "session");
        const created = await ensureSession(name, origin || "");
        const draft = await getTabDraft(tabId, origin || "");
        if (draft && Object.keys(draft.endpoints || {}).length > 0) {
          await patchSession(created.id, (session) => {
            session.endpoints = { ...(draft.endpoints || {}) };
            session.meta = {
              ...(session.meta || {}),
              ...(draft.meta || {}),
              appOrigin: origin || draft.meta?.appOrigin || "",
              isDraft: false,
              updatedAt: Date.now(),
            };
          });
        }
        await setTabActiveSessionId(tabId, created.id);
        await clearTabDraft(tabId);
        sendResponse({ ok: true, session: { id: created.id, name: created.name } });
        return;
      }
      case MSG.SET_ACTIVE_SESSION: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const ok = await setActiveSession(tabId, message?.sessionId);
        if (!ok) {
          sendResponse({ ok: false, error: "Session not found" });
          return;
        }
        sendResponse({ ok: true });
        return;
      }
      case MSG.DELETE_SESSION: {
        const tabId = message?.tabId ?? sender?.tab?.id;
        const result = await deleteSession(tabId, message?.sessionId, origin || "");
        sendResponse(result);
        return;
      }
      case MSG.RENAME_SESSION: {
        const result = await renameSession(message?.sessionId, message?.name);
        sendResponse(result);
        return;
      }
      case MSG.GET_EXTENSION_ENABLED: {
        const extensionEnabled = await getExtensionEnabled();
        sendResponse({ ok: true, extensionEnabled });
        return;
      }
      case MSG.SET_EXTENSION_ENABLED: {
        const extensionEnabled = Boolean(message?.enabled);
        await setExtensionEnabled(extensionEnabled);
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (!tab.id) continue;
          if (!extensionEnabled) {
            await setTabMode(tab.id, MODES.REAL);
            setBadge(tab.id, MODES.REAL);
          }
          chrome.tabs.sendMessage(tab.id, { type: "SYNC_STATE_TO_PAGE" }, () => void chrome.runtime.lastError);
        }
        sendResponse({ ok: true, extensionEnabled });
        return;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err) });
  });
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.local.remove([tabModeKey(tabId), tabActiveSessionKey(tabId), tabDraftKey(tabId)]);
});

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus().catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    if (info.menuItemId !== CONTEXT_MENU_ADD || !tab?.id) return;
    const endpoint = extractContextEndpoint(info, tab);
    if (!endpoint?.url) return;
    let origin = "";
    try {
      origin = new URL(tab.url || endpoint.url).origin;
    } catch {
      return;
    }
    await addEndpointToActiveSession(tab.id, origin, {
      method: endpoint.method || "GET",
      url: endpoint.url,
      status: 200,
      headers: { "content-type": "application/json" },
      body: { mocked: true, source: "context-menu" },
    });
  })().catch(() => {});
});
