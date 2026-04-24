const INJECT_EVENT = "MOCKMATE_INJECT";
const CONTENT_EVENT = "MOCKMATE_CONTENT";
const LOG_PREFIX = "[MOCKMATE]";

function getOrigin() {
  return window.location.origin;
}

let currentState = null;
let bannerEl = null;
let mockHitCount = 0;
let lastMockHit = "";
let currentCounts = { total: 0, mocked: 0, captured: 0 };
let extensionAlive = true;
const BANNER_HEIGHT_PX = 40;
let originalBodyPaddingTop = null;

function isExtensionAlive() {
  return extensionAlive && Boolean(chrome?.runtime?.id);
}

function markExtensionDead(error) {
  extensionAlive = false;
  if (bannerEl?.isConnected) bannerEl.remove();
  console.debug(`${LOG_PREFIX} extension context unavailable`, error);
}

function safeSendMessage(message, callback) {
  if (!isExtensionAlive()) {
    if (callback) callback(null);
    return;
  }
  try {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        markExtensionDead(chrome.runtime.lastError.message);
        if (callback) callback(null);
        return;
      }
      if (callback) callback(res);
    });
  } catch (error) {
    markExtensionDead(error?.message || error);
    if (callback) callback(null);
  }
}

function ensureBanner() {
  if (bannerEl) return bannerEl;
  bannerEl = document.createElement("div");
  bannerEl.id = "mockmate-banner";
  bannerEl.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:2147483647",
    "height:40px",
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "padding:0 12px",
    "font:600 13px 'Segoe UI', system-ui, sans-serif",
    "line-height:1.2",
    "color:#ffffff",
    "text-shadow:0 1px 1px rgba(0,0,0,0.35)",
    "border-bottom:1px solid rgba(255,255,255,0.22)",
    "backdrop-filter: blur(6px)",
  ].join(";");
  bannerEl.innerHTML = `<span id="mmBannerText" style="font-weight:700; font-size:13px;"></span><span id="mmBannerHint" style="opacity:.96; font-size:12px; margin-left:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:60vw;"></span>`;
  const mount = () => {
    if (!document.documentElement) return;
    if (!bannerEl.isConnected) document.documentElement.appendChild(bannerEl);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
  return bannerEl;
}

function setBannerVisible(visible) {
  if (!visible) {
    if (bannerEl?.isConnected) bannerEl.remove();
    const body = document.body;
    if (body && originalBodyPaddingTop !== null) {
      body.style.paddingTop = originalBodyPaddingTop;
      originalBodyPaddingTop = null;
    }
    return;
  }
  ensureBanner();
  const body = document.body;
  if (body) {
    if (originalBodyPaddingTop === null) {
      originalBodyPaddingTop = body.style.paddingTop || "";
    }
    const computedPaddingTop = Number.parseFloat(getComputedStyle(body).paddingTop || "0");
    if (!Number.isNaN(computedPaddingTop) && computedPaddingTop < BANNER_HEIGHT_PX) {
      body.style.paddingTop = `${BANNER_HEIGHT_PX}px`;
    }
  }
}

function updateBanner(state, counts) {
  if (!state || state.extensionEnabled === false) {
    setBannerVisible(false);
    return;
  }
  const mode = state.mode;
  setBannerVisible(true);
  const el = ensureBanner();
  const textEl = el.querySelector("#mmBannerText");
  const hintEl = el.querySelector("#mmBannerHint");

  const modeLabel = mode.toUpperCase();
  const color =
    mode === "record" ? "rgba(185, 28, 28, 0.97)" :
    mode === "replay" ? "rgba(180, 83, 9, 0.97)" :
    "rgba(30, 41, 59, 0.97)";
  el.style.background = color;
  const mocked = counts?.mocked ?? 0;
  const total = counts?.total ?? 0;
  const captured = counts?.captured ?? 0;

  if (mode === "record") {
    textEl.textContent = `MockMate · ${modeLabel} · captured:${captured} · hits:${mockHitCount}`;
    hintEl.textContent = "Recording ON: your journey is being captured. Save this session when done.";
  } else if (mode === "replay") {
    textEl.textContent = `MockMate · ${modeLabel} · enabled:${mocked}/${total}`;
    hintEl.textContent = lastMockHit || "Replay ON: mock APIs are active for enabled endpoints.";
  } else {
    textEl.textContent = `MockMate · ${modeLabel}`;
    hintEl.textContent = "Popup: enable Record or Replay";
  }
}

function flashBannerForMockHit() {
  if (!bannerEl) return;
  bannerEl.style.boxShadow = "0 0 0 2px rgba(255, 235, 59, 0.8), 0 0 16px rgba(255, 193, 7, 0.65)";
  setTimeout(() => {
    if (bannerEl) bannerEl.style.boxShadow = "";
  }, 500);
}

async function getCountsForBanner() {
  return new Promise((resolve) => {
    safeSendMessage({ type: "GET_SNAPSHOT", origin: getOrigin() }, (res) => {
      const endpoints = res?.snapshot?.endpoints || {};
      const keys = Object.keys(endpoints);
      const total = keys.length;
      const mocked = keys.filter((k) => endpoints[k]?.enabled !== false).length;
      resolve({ total, mocked, captured: total });
    });
  });
}

function refreshBannerCounts() {
  if (!currentState) return;
  getCountsForBanner().then((counts) => {
    currentCounts = counts;
    updateBanner(currentState, currentCounts);
  });
}

function injectMainScript() {
  if (!isExtensionAlive()) return;
  const script = document.createElement("script");
  try {
    script.src = chrome.runtime.getURL("injected.js");
  } catch (error) {
    markExtensionDead(error?.message || error);
    return;
  }
  script.async = false;
  (document.documentElement || document.head).appendChild(script);
  script.onload = () => script.remove();
}

function postToInjected(payload) {
  window.postMessage({ source: CONTENT_EVENT, ...payload }, "*");
}

function notifyState() {
  safeSendMessage({ type: "GET_STATE_FOR_ORIGIN", origin: getOrigin() }, (res) => {
    if (!res?.ok) return;
    currentState = res;
    if (res.mode !== "replay" || res.extensionEnabled === false) {
      mockHitCount = 0;
      lastMockHit = "";
    }
    postToInjected({ type: "STATE_UPDATE", state: res });
    refreshBannerCounts();
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== INJECT_EVENT) return;
  if (!isExtensionAlive()) return;

  if (msg.type === "RECORD_CAPTURE") {
    safeSendMessage(
      { type: "RECORD_CAPTURE", origin: getOrigin(), payload: msg.payload },
      () => {
        // Keep session count in banner aligned with actual saved snapshot.
        refreshBannerCounts();
      }
    );
    return;
  }

  if (msg.type === "GET_ENDPOINT_FOR_REQUEST") {
    safeSendMessage(
      { type: "GET_ENDPOINT_FOR_REQUEST", origin: getOrigin(), method: msg.method, url: msg.url },
      (res) => {
        postToInjected({ type: "GET_ENDPOINT_FOR_REQUEST_RESULT", requestId: msg.requestId, result: res || { ok: false } });
      }
    );
    return;
  }

  if (msg.type === "MOCK_HIT") {
    mockHitCount += 1;
    const hit = msg.payload || {};
    const shortUrl = typeof hit.url === "string" ? hit.url.slice(0, 88) : "";
    lastMockHit = `MOCKED: ${hit.method || "GET"} ${shortUrl}`;
    flashBannerForMockHit();
    updateBanner(currentState, currentCounts);
    return;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!isExtensionAlive()) return;
  if (message?.type === "SYNC_STATE_TO_PAGE") notifyState();
});

injectMainScript();
notifyState();
console.debug(`${LOG_PREFIX} content initialized`);
