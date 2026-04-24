(function () {
  const INJECT_EVENT = "MOCKMATE_INJECT";
  const CONTENT_EVENT = "MOCKMATE_CONTENT";
  const LOG_PREFIX = "[MOCKMATE]";

  const MODES = { REAL: "real", RECORD: "record", REPLAY: "replay" };

  let state = { mode: MODES.REAL, delayMs: 0, extensionEnabled: true };
  let seq = 0;
  const pending = new Map();

  function isJsonResponse(contentType) {
    return typeof contentType === "string" && contentType.includes("application/json");
  }

  function normalizeReplayBody(endpoint) {
    const body = endpoint?.body ?? null;
    if (body === null) return "";
    if (typeof body === "string") return body;
    const contentType = String(endpoint?.contentType || "");
    if (isJsonResponse(contentType)) return JSON.stringify(body);
    return String(body);
  }

  function postToContent(payload) {
    window.postMessage({ source: INJECT_EVENT, ...payload }, "*");
  }

  function notifyMockHit(payload) {
    postToContent({ type: "MOCK_HIT", payload });
  }

  function requestEndpoint(method, url) {
    return new Promise((resolve) => {
      const requestId = ++seq;
      pending.set(requestId, resolve);
      postToContent({ type: "GET_ENDPOINT_FOR_REQUEST", requestId, method, url });
      setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          resolve({ ok: true, mocked: false });
        }
      }, 3000);
    });
  }

  function wait(ms) {
    if (!ms || ms < 1) return Promise.resolve();
    return new Promise((r) => setTimeout(r, ms));
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== CONTENT_EVENT) return;

    if (msg.type === "STATE_UPDATE") {
      state = msg.state || state;
      return;
    }
    if (msg.type === "GET_ENDPOINT_FOR_REQUEST_RESULT") {
      const resolve = pending.get(msg.requestId);
      if (!resolve) return;
      pending.delete(msg.requestId);
      resolve(msg.result || { ok: true, mocked: false });
    }
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function mockmateFetch(input, init = {}) {
    const req = new Request(input, init);
    const url = req.url;
    const method = (req.method || "GET").toUpperCase();

    if (state.extensionEnabled !== false && state.mode === MODES.REPLAY) {
      const replay = await requestEndpoint(method, url);
      if (replay?.ok && replay?.mocked && replay?.endpoint) {
        await wait(replay.delayMs || 0);
        const ep = replay.endpoint;
        const responseBody = normalizeReplayBody(ep);
        console.info(`${LOG_PREFIX} MOCKED ${method} ${url} (status:${ep.status || 200})`);
        notifyMockHit({ method, url, status: ep.status || 200, transport: "fetch" });
        return new Response(responseBody, {
          status: ep.status || 200,
          headers: {
            "Content-Type": ep.contentType || "application/json",
            "X-MockMate-Replay": "true",
            ...(ep.headers || {}),
          },
        });
      }
    }

    const response = await originalFetch(input, init);
    if (state.extensionEnabled !== false && state.mode === MODES.RECORD) {
      try {
        const clone = response.clone();
        const contentType = clone.headers.get("content-type") || "";
        let body = null;
        if (isJsonResponse(contentType)) {
          try {
            body = await clone.json();
          } catch {
            body = await clone.text();
          }
        } else {
          body = await clone.text();
        }
        postToContent({
          type: "RECORD_CAPTURE",
          payload: {
            method,
            url,
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body,
            contentType,
          },
        });
      } catch (e) {
        console.debug(`${LOG_PREFIX} record skip fetch`, e);
      }
    }
    return response;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__mmMethod = (method || "GET").toUpperCase();
    this.__mmUrl = new URL(url, window.location.href).toString();
    return xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const method = this.__mmMethod || "GET";
    const url = this.__mmUrl;

    if (state.extensionEnabled !== false && state.mode === MODES.REPLAY && url) {
      requestEndpoint(method, url).then(async (replay) => {
        if (!(replay?.ok && replay?.mocked && replay?.endpoint)) {
          xhrSend.call(this, body);
          return;
        }
        await wait(replay.delayMs || 0);
        const ep = replay.endpoint;
        const responseText = normalizeReplayBody(ep);
        console.info(`${LOG_PREFIX} MOCKED ${method} ${url} (status:${ep.status || 200})`);
        notifyMockHit({ method, url, status: ep.status || 200, transport: "xhr" });
        Object.defineProperty(this, "readyState", { configurable: true, get: () => 4 });
        Object.defineProperty(this, "status", { configurable: true, get: () => ep.status || 200 });
        Object.defineProperty(this, "responseText", { configurable: true, get: () => responseText });
        Object.defineProperty(this, "response", { configurable: true, get: () => responseText });
        setTimeout(() => {
          this.dispatchEvent(new Event("readystatechange"));
          this.dispatchEvent(new Event("load"));
          this.dispatchEvent(new Event("loadend"));
        }, 0);
      });
      return;
    }

    if (state.extensionEnabled !== false && state.mode === MODES.RECORD && url) {
      this.addEventListener("loadend", () => {
        try {
          const contentType = this.getResponseHeader("content-type") || "";
          let parsed = null;
          if (isJsonResponse(contentType) && typeof this.response === "object" && this.response !== null) {
            // responseType='json' path (common in Angular/XHR)
            parsed = this.response;
          } else if (isJsonResponse(contentType)) {
            const text = this.responseText || "";
            parsed = text ? JSON.parse(text) : null;
          } else {
            parsed = this.responseText || "";
          }
          postToContent({
            type: "RECORD_CAPTURE",
            payload: {
              method,
              url,
              status: this.status,
              headers: { "content-type": contentType },
              body: parsed,
              contentType,
            },
          });
        } catch (e) {
          console.debug(`${LOG_PREFIX} record skip xhr`, e);
        }
      });
    }

    return xhrSend.call(this, body);
  };
})();
