const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MOVEIT2_SERVER_WS_URL = "ws://127.0.0.1:8765/ws";
const MOVEIT2_PROTOCOL_VERSION = 1;

const pendingRequests = new Map();
let socket = null;
let socketUrl = "";

function defaultMoveIt2ServerEnabled() {
  if (explicitMoveIt2ServerUrl()) {
    return true;
  }
  const env = typeof import.meta !== "undefined" ? import.meta.env : null;
  if (env && typeof env === "object" && Object.hasOwn(env, "DEV")) {
    return Boolean(env.DEV);
  }
  return true;
}

export function moveit2ServerEnabled({ enabled = defaultMoveIt2ServerEnabled() } = {}) {
  return Boolean(enabled);
}

function normalizeRequestId(value) {
  const id = String(value || "").trim();
  if (id) {
    return id;
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `moveit2-server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function configuredMoveIt2ServerUrl({ enabled = moveit2ServerEnabled() } = {}) {
  if (!moveit2ServerEnabled({ enabled })) {
    return "";
  }
  const envUrl = typeof import.meta !== "undefined"
    ? String(import.meta.env?.VIEWER_MOVEIT2_WS_URL || "").trim()
    : "";
  if (envUrl) {
    return envUrl;
  }
  return DEFAULT_MOVEIT2_SERVER_WS_URL;
}

function explicitMoveIt2ServerUrl() {
  const envUrl = typeof import.meta !== "undefined"
    ? String(import.meta.env?.VIEWER_MOVEIT2_WS_URL || "").trim()
    : "";
  if (envUrl) {
    return envUrl;
  }
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return String(new URL(window.location.href).searchParams.get("moveit2Ws") || "").trim();
  } catch {
    return "";
  }
}

export function moveit2ServerUrl({ enabled = moveit2ServerEnabled() } = {}) {
  if (!moveit2ServerEnabled({ enabled })) {
    return "";
  }
  if (typeof window === "undefined") {
    return configuredMoveIt2ServerUrl({ enabled });
  }
  const queryUrl = explicitMoveIt2ServerUrl();
  return String(queryUrl || "").trim() || configuredMoveIt2ServerUrl({ enabled });
}

function rejectPendingRequests(message) {
  for (const [id, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
    pendingRequests.delete(id);
  }
}

function resetSocket(message = "MoveIt2 server connection closed.") {
  rejectPendingRequests(message);
  socket = null;
  socketUrl = "";
}

function ensureMoveIt2ServerSocket(url, WebSocketImpl) {
  if (!WebSocketImpl) {
    throw new Error("MoveIt2 server requires browser WebSocket support.");
  }
  if (socket && socketUrl === url && socket.readyState <= WebSocketImpl.OPEN) {
    return socket;
  }
  if (socket) {
    socket.close();
    resetSocket("MoveIt2 server connection changed.");
  }
  socket = new WebSocketImpl(url);
  socketUrl = url;
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data || ""));
    } catch {
      return;
    }
    const id = String(message?.id || "").trim();
    const pending = pendingRequests.get(id);
    if (!pending) {
      return;
    }
    pendingRequests.delete(id);
    clearTimeout(pending.timer);
    if (message?.ok === false) {
      pending.reject(new Error(String(message?.error?.message || "MoveIt2 server request failed.")));
      return;
    }
    pending.resolve(message?.result ?? {});
  });
  socket.addEventListener("close", () => resetSocket("MoveIt2 server connection closed."));
  socket.addEventListener("error", () => {
    if (socket?.readyState !== WebSocketImpl.OPEN) {
      resetSocket(`Could not connect to MoveIt2 server at ${url}.`);
    }
  });
  return socket;
}

function sendWhenOpen(activeSocket, message, resolve, reject) {
  const openState = activeSocket.constructor?.OPEN ?? 1;
  if (activeSocket.readyState === openState) {
    activeSocket.send(message);
    resolve();
    return;
  }
  const handleOpen = () => {
    activeSocket.removeEventListener("open", handleOpen);
    activeSocket.send(message);
    resolve();
  };
  activeSocket.addEventListener("open", handleOpen);
}

export function moveit2ServerAvailable({
  WebSocketImpl = globalThis.WebSocket,
  enabled = moveit2ServerEnabled(),
} = {}) {
  return Boolean(enabled && WebSocketImpl);
}

export function checkMoveIt2ServerLive({
  timeoutMs = 1000,
  url = moveit2ServerUrl(),
  WebSocketImpl = globalThis.WebSocket,
  enabled = moveit2ServerEnabled(),
} = {}) {
  const safeTimeoutMs = Math.max(Number(timeoutMs) || 1000, 1);
  return new Promise((resolve) => {
    if (!enabled || !url || !WebSocketImpl) {
      resolve(false);
      return;
    }
    let settled = false;
    let activeSocket = null;
    let timer = 0;
    const settle = (isLive) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (activeSocket && isLive) {
        activeSocket.close();
      }
      resolve(Boolean(isLive));
    };
    timer = setTimeout(() => settle(false), safeTimeoutMs);
    try {
      activeSocket = new WebSocketImpl(url);
    } catch {
      settle(false);
      return;
    }
    activeSocket.addEventListener("open", () => settle(true));
    activeSocket.addEventListener("error", () => settle(false));
    activeSocket.addEventListener("close", () => settle(false));
  });
}

export function requestMoveIt2Server(type, payload, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  url = moveit2ServerUrl(),
  WebSocketImpl = globalThis.WebSocket,
  enabled = moveit2ServerEnabled(),
} = {}) {
  const id = normalizeRequestId(payload?.id);
  const safeTimeoutMs = Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1);
  return new Promise((resolve, reject) => {
    if (!enabled || !url) {
      reject(new Error("MoveIt2 server connections are not enabled for this viewer session."));
      return;
    }
    let activeSocket;
    try {
      activeSocket = ensureMoveIt2ServerSocket(url, WebSocketImpl);
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`MoveIt2 server request ${id} timed out.`));
    }, safeTimeoutMs);
    pendingRequests.set(id, { resolve, reject, timer });
    const message = JSON.stringify({
      id,
      type,
      protocolVersion: MOVEIT2_PROTOCOL_VERSION,
      payload
    });
    sendWhenOpen(activeSocket, message, () => {}, (error) => {
      pendingRequests.delete(id);
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function closeMoveIt2ServerConnection() {
  if (socket) {
    socket.close();
  }
  resetSocket("MoveIt2 server connection closed.");
}
