import { WebSocketServer } from "ws";

const WS_PORT = Number.parseInt(process.env.CS_UPDATES_WS_PORT || "8787", 10);
const API_BASE_URL = (process.env.CS_UPDATES_API_BASE_URL || "http://127.0.0.1/api/index.php").replace(/\/+$/, "");
const POLL_INTERVAL_MS = Number.parseInt(process.env.CS_UPDATES_WS_POLL_MS || "5000", 10);
const HISTORY_LIMIT = Number.parseInt(process.env.CS_UPDATES_WS_HISTORY_LIMIT || "20", 10);

let lastSeenId = 0;

function log(message, context = {}) {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [cs-updates-ws] ${message}`, context);
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchLatestItems() {
  const url = `${API_BASE_URL}/api/v1/cs-updates?limit=${HISTORY_LIMIT}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`REST fetch failed: ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
  return items;
}

function broadcastJson(wss, topic, payload) {
  const serialized = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState !== 1) {
      continue;
    }

    if (!client.subscriptions?.has(topic)) {
      continue;
    }

    client.send(serialized);
  }
}

async function pollAndBroadcast(wss) {
  try {
    const items = await fetchLatestItems();
    const sortedAscending = [...items].sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));

    const newItems = sortedAscending.filter((item) => Number(item?.id || 0) > lastSeenId);

    if (sortedAscending.length > 0) {
      const newest = sortedAscending[sortedAscending.length - 1];
      lastSeenId = Math.max(lastSeenId, Number(newest?.id || 0));
    }

    for (const item of newItems) {
      broadcastJson(wss, "cs_updates", {
        type: "cs_update.created",
        item,
      });
    }

    if (newItems.length > 0) {
      log("broadcasted new items", { count: newItems.length, lastSeenId });
    }
  } catch (error) {
    log("poll failed", { error: String(error?.message || error) });
  }
}

const wss = new WebSocketServer({ port: WS_PORT, path: "/ws/updates" });

wss.on("connection", (socket) => {
  socket.subscriptions = new Set();

  socket.send(
    JSON.stringify({
      type: "hello",
      topic: "cs_updates",
      ts: Date.now(),
    }),
  );

  socket.on("message", (raw) => {
    const message = safeJsonParse(String(raw || ""));
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "subscribe" && message.topic === "cs_updates") {
      socket.subscriptions.add("cs_updates");
      socket.send(JSON.stringify({ type: "subscribed", topic: "cs_updates", ts: Date.now() }));
      return;
    }

    if (message.type === "pong") {
      return;
    }
  });
});

setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState !== 1) {
      continue;
    }
    client.send(JSON.stringify({ type: "ping", ts: Date.now() }));
  }
}, 25000);

setInterval(() => {
  void pollAndBroadcast(wss);
}, POLL_INTERVAL_MS);

await pollAndBroadcast(wss);
log("gateway started", { wsPort: WS_PORT, apiBaseUrl: API_BASE_URL, pollIntervalMs: POLL_INTERVAL_MS });
