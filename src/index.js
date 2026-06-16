// Omnigent Cloudflare - Full Server Implementation
//
// Complete port of Omnigent server to Cloudflare Workers + D1 + Durable Objects.
// Supports: runner tunnels, session dispatch, multi-device resume, agent execution.

// ── Constants ────────────────────────────────────────────────────────

const RUNNER_TUNNEL_TOKEN_HEADER = "x-omnigent-runner-token";
const FRAME_PROTOCOL_VERSION = 1;
const PING_INTERVAL_MS = 30000;
const PING_MISS_THRESHOLD = 3;

// ── Frame Types ──────────────────────────────────────────────────────

class PingFrame {
  constructor(ts) { this.kind = "ping"; this.ts = ts; }
}
class PongFrame {
  constructor(ts) { this.kind = "pong"; this.ts = ts; }
}
class HelloFrame {
  constructor(data) {
    this.kind = "hello";
    this.frame_protocol_version = data.frame_protocol_version || 1;
    this.runner_version = data.runner_version || "unknown";
    this.harnesses = data.harnesses || [];
    this.env_types = data.env_types || [];
  }
}
class RequestFrame {
  constructor(data) {
    this.kind = "request";
    this.request_id = data.request_id;
    this.method = data.method;
    this.path = data.path;
    this.headers = data.headers || {};
    this.body = data.body;
  }
}
class ResponseFrame {
  constructor(data) {
    this.kind = "response";
    this.request_id = data.request_id;
    this.status = data.status;
    this.headers = data.headers || {};
    this.body = data.body;
  }
}

function encodeFrame(frame) {
  return JSON.stringify(frame);
}

function decodeFrame(raw) {
  const data = JSON.parse(raw);
  switch (data.kind) {
    case "hello": return new HelloFrame(data);
    case "ping": return new PingFrame(data.ts);
    case "pong": return new PongFrame(data.ts);
    case "request": return new RequestFrame(data);
    case "response": return new ResponseFrame(data);
    default: return data;
  }
}

// ── Tunnel Durable Object ────────────────────────────────────────────

export class Tunnel {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ws = null;
    this.runnerId = null;
    this.owner = null;
    this.hello = null;
    this.connectedAt = null;
    this.lastFrameAt = null;
    this.outboundQueue = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade for runner tunnel
    if (url.pathname === "/ws") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      this.handleWebSocket(server, request);

      return new Response(null, { status: 101, webSocket: client });
    }

    // Send request to runner (used by session dispatch)
    if (url.pathname === "/send" && request.method === "POST") {
      const body = await request.json();
      return this.sendToRunner(body);
    }

    // Check if runner is online
    if (url.pathname === "/status") {
      return new Response(JSON.stringify({
        runner_id: this.runnerId,
        online: this.ws !== null,
        owner: this.owner,
        hello: this.hello,
        connected_at: this.connectedAt,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async handleWebSocket(ws, request) {
    ws.accept();
    this.ws = ws;
    this.connectedAt = new Date().toISOString();
    this.lastFrameAt = Date.now();

    // Extract runner_id from URL
    const url = new URL(request.url);
    this.runnerId = url.searchParams.get("runner_id") || `runner_${crypto.randomUUID().slice(0, 8)}`;
    this.owner = url.searchParams.get("owner") || "local";

    // Start ping loop
    const pingInterval = setInterval(() => {
      if (this.ws) {
        try {
          this.ws.send(encodeFrame(new PingFrame(Date.now())));
        } catch {
          this.cleanup();
        }
      }
    }, PING_INTERVAL_MS);

    ws.addEventListener("message", async (event) => {
      try {
        this.lastFrameAt = Date.now();
        const frame = decodeFrame(event.data);

        if (frame.kind === "hello") {
          this.hello = frame;
          // Store runner in D1
          await this.env.DB.prepare(
            `INSERT OR REPLACE INTO runner_tunnels 
             (runner_id, owner, status, connected_at, harnesses, version)
             VALUES (?, ?, 'connected', datetime('now'), ?, ?)`
          ).bind(
            this.runnerId,
            this.owner,
            JSON.stringify(frame.harnesses),
            frame.runner_version
          ).run();

          console.log(`Runner connected: ${this.runnerId} (${frame.harnesses.join(", ")})`);
        }

        if (frame.kind === "response") {
          // Route response back to the waiting request
          await this.routeResponse(frame);
        }

        if (frame.kind === "pong") {
          // Keepalive acknowledged
        }
      } catch (e) {
        console.error(`Tunnel message error: ${e}`);
      }
    });

    ws.addEventListener("close", () => {
      this.cleanup();
      clearInterval(pingInterval);
    });
  }

  async sendToRunner(body) {
    if (!this.ws) {
      return new Response(
        JSON.stringify({ error: "Runner not connected" }),
        { status: 504, headers: { "Content-Type": "application/json" } }
      );
    }

    const requestId = body.request_id || `req_${crypto.randomUUID().slice(0, 8)}`;
    const frame = new RequestFrame({
      request_id: requestId,
      method: body.method || "POST",
      path: body.path || "/",
      headers: body.headers || {},
      body: body.body,
    });

    // Store pending request
    await this.state.storage.put(`pending:${requestId}`, {
      requestId,
      createdAt: Date.now(),
    });

    // Send to runner
    try {
      this.ws.send(encodeFrame(frame));
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Failed to send to runner" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Wait for response (with timeout)
    const startTime = Date.now();
    const timeout = 30000; // 30s timeout

    while (Date.now() - startTime < timeout) {
      const pending = await this.state.storage.get(`pending:${requestId}`);
      if (!pending) {
        // Response was received and cleaned up
        const response = await this.state.storage.get(`response:${requestId}`);
        if (response) {
          await this.state.storage.delete(`response:${requestId}`);
          return new Response(JSON.stringify(response), {
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }

    // Timeout
    await this.state.storage.delete(`pending:${requestId}`);
    return new Response(
      JSON.stringify({ error: "Request timeout" }),
      { status: 504, headers: { "Content-Type": "application/json" } }
    );
  }

  async routeResponse(frame) {
    const requestId = frame.request_id;
    if (!requestId) return;

    // Store response
    await this.state.storage.put(`response:${requestId}`, {
      request_id: requestId,
      status: frame.status || 200,
      headers: frame.headers || {},
      body: frame.body,
    });

    // Clean up pending
    await this.state.storage.delete(`pending:${requestId}`);
  }

  cleanup() {
    if (this.runnerId) {
      // Mark runner as offline in D1
      this.env.DB.prepare(
        `UPDATE runner_tunnels SET status = 'disconnected', disconnected_at = datetime('now')
         WHERE runner_id = ?`
      ).bind(this.runnerId).run().catch(() => {});

      // Update sessions using this runner
      this.env.DB.prepare(
        `UPDATE conversations SET runner_id = NULL WHERE runner_id = ?`
      ).bind(this.runnerId).run().catch(() => {});
    }
    this.ws = null;
    this.runnerId = null;
  }
}

// ── Router ───────────────────────────────────────────────────────────

class Router {
  constructor() {
    this.routes = [];
  }

  addRoute(method, path, handler) {
    this.routes.push({
      pattern: new URLPattern({ pathname: path }),
      method,
      handler,
    });
  }

  async handle(req, env, ctx) {
    const url = new URL(req.url);

    for (const route of this.routes) {
      if (route.method !== req.method && route.method !== "*") continue;

      const match = route.pattern.exec(url);
      if (match) {
        req.params = match.pathname.groups;
        try {
          return await route.handler(req, env, ctx);
        } catch (e) {
          console.error(`Route error: ${e}`);
          return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      }
    }
    return null;
  }
}

// ── API Handlers ─────────────────────────────────────────────────────

// Health
async function healthHandler(req, env) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  const result = { status: "ok", version: "1.0.0" };

  if (sessionId) {
    const session = await env.DB.prepare(
      "SELECT id, runner_id, host_id FROM conversations WHERE id = ?"
    ).bind(sessionId).first();
    if (session) {
      result.session = {
        runner_online: session.runner_id != null,
        host_online: session.host_id != null,
      };
    }
  }

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}

// Agents
async function listAgentsHandler(_req, env) {
  const agents = await env.DB.prepare("SELECT * FROM agents ORDER BY name").all();
  return new Response(JSON.stringify(agents.results), {
    headers: { "Content-Type": "application/json" },
  });
}

async function getAgentHandler(req, env) {
  const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?")
    .bind(req.params.id).first();
  if (!agent) {
    return new Response(JSON.stringify({ error: "Agent not found" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(agent), {
    headers: { "Content-Type": "application/json" },
  });
}

// Sessions
async function createSessionHandler(req, env) {
  const body = await req.json();
  const sessionId = `conv_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO conversations (id, agent_id, title, workspace, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).bind(sessionId, body.agent_id, body.title || null, body.workspace || null, body.created_by || null, now, now).run();

  const session = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?")
    .bind(sessionId).first();

  return new Response(JSON.stringify(session), {
    status: 201, headers: { "Content-Type": "application/json" },
  });
}

async function listSessionsHandler(req, env) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const sessions = await env.DB.prepare(
    `SELECT c.*, a.name as agent_name 
     FROM conversations c 
     LEFT JOIN agents a ON c.agent_id = a.id 
     ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return new Response(JSON.stringify(sessions.results), {
    headers: { "Content-Type": "application/json" },
  });
}

async function getSessionHandler(req, env) {
  const session = await env.DB.prepare(
    `SELECT c.*, a.name as agent_name 
     FROM conversations c 
     LEFT JOIN agents a ON c.agent_id = a.id 
     WHERE c.id = ?`
  ).bind(req.params.id).first();

  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  // Get runner status if assigned
  if (session.runner_id) {
    const runner = await env.DB.prepare(
      "SELECT * FROM runner_tunnels WHERE runner_id = ?"
    ).bind(session.runner_id).first();
    session.runner_online = runner?.status === "connected";
  }

  return new Response(JSON.stringify(session), {
    headers: { "Content-Type": "application/json" },
  });
}

async function deleteSessionHandler(req, env) {
  await env.DB.prepare("DELETE FROM conversation_items WHERE conversation_id = ?")
    .bind(req.params.id).run();
  await env.DB.prepare("DELETE FROM conversations WHERE id = ?")
    .bind(req.params.id).run();
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Messages
async function postMessageHandler(req, env) {
  const body = await req.json();
  const itemId = `item_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO conversation_items (id, conversation_id, role, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(itemId, req.params.id, body.role || "user", body.content, body.metadata || null, now).run();

  await env.DB.prepare(
    "UPDATE conversations SET updated_at = ? WHERE id = ?"
  ).bind(now, req.params.id).run();

  // If there's a connected runner, dispatch the message
  const session = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?")
    .bind(req.params.id).first();

  if (session?.runner_id) {
    // Try to send to runner via Durable Object
    const runnerId = session.runner_id;
    try {
      const doId = env.TUNNEL.idFromName(runnerId);
      const stub = env.TUNNEL.get(doId);
      // Send message to runner for processing
      await stub.fetch(new Request("http://internal/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "POST",
          path: `/v1/sessions/${req.params.id}/messages`,
          body: { content: body.content, role: body.role },
        }),
      }));
    } catch (e) {
      console.log(`Could not dispatch to runner: ${e}`);
    }
  }

  return new Response(JSON.stringify({ id: itemId, ok: true }), {
    status: 201, headers: { "Content-Type": "application/json" },
  });
}

async function listMessagesHandler(req, env) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const after = url.searchParams.get("after");

  let query = "SELECT * FROM conversation_items WHERE conversation_id = ?";
  const params = [req.params.id];

  if (after) {
    query += " AND created_at > ?";
    params.push(after);
  }

  query += " ORDER BY created_at ASC LIMIT ?";
  params.push(limit);

  const messages = await env.DB.prepare(query).bind(...params).all();
  return new Response(JSON.stringify(messages.results), {
    headers: { "Content-Type": "application/json" },
  });
}

// Runners
async function listRunnersHandler(req, env) {
  const runners = await env.DB.prepare(
    "SELECT * FROM runner_tunnels WHERE status = 'connected' ORDER BY connected_at DESC"
  ).all();

  // Also check Durable Objects for live status
  const liveRunners = [];
  for (const runner of runners.results) {
    try {
      const doId = env.TUNNEL.idFromName(runner.runner_id);
      const stub = env.TUNNEL.get(doId);
      const status = await stub.fetch(new Request("http://internal/status"));
      const data = await status.json();
      if (data.online) {
        liveRunners.push({
          ...runner,
          harnesses: JSON.parse(runner.harnesses || "[]"),
          online: true,
        });
      }
    } catch {
      // Runner DO not found or offline
    }
  }

  return new Response(JSON.stringify(liveRunners), {
    headers: { "Content-Type": "application/json" },
  });
}

async function getRunnerStatusHandler(req, env) {
  try {
    const doId = env.TUNNEL.idFromName(req.params.id);
    const stub = env.TUNNEL.get(doId);
    const status = await stub.fetch(new Request("http://internal/status"));
    const data = await status.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ runner_id: req.params.id, online: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Hosts
async function listHostsHandler(_req, env) {
  const hosts = await env.DB.prepare("SELECT * FROM hosts ORDER BY last_seen DESC").all();
  return new Response(JSON.stringify(hosts.results), {
    headers: { "Content-Type": "application/json" },
  });
}

async function registerHostHandler(req, env) {
  const body = await req.json();
  const hostId = `host_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO hosts (id, name, status, last_seen, capabilities, created_at, updated_at)
     VALUES (?, ?, 'online', ?, ?, ?, ?)`
  ).bind(hostId, body.name, now, body.capabilities || null, now, now).run();

  return new Response(JSON.stringify({ id: hostId, ok: true }), {
    status: 201, headers: { "Content-Type": "application/json" },
  });
}

// ── Build Router ─────────────────────────────────────────────────────

function buildRouter() {
  const router = new Router();

  // Health
  router.addRoute("GET", "/health", healthHandler);

  // Agents
  router.addRoute("GET", "/v1/agents", listAgentsHandler);
  router.addRoute("GET", "/v1/agents/{id}", getAgentHandler);

  // Sessions
  router.addRoute("POST", "/v1/sessions", createSessionHandler);
  router.addRoute("GET", "/v1/sessions", listSessionsHandler);
  router.addRoute("GET", "/v1/sessions/{id}", getSessionHandler);
  router.addRoute("DELETE", "/v1/sessions/{id}", deleteSessionHandler);

  // Messages
  router.addRoute("POST", "/v1/sessions/{id}/messages", postMessageHandler);
  router.addRoute("GET", "/v1/sessions/{id}/messages", listMessagesHandler);

  // Runners
  router.addRoute("GET", "/v1/runners", listRunnersHandler);
  router.addRoute("GET", "/v1/runners/{id}/status", getRunnerStatusHandler);

  // Hosts
  router.addRoute("GET", "/v1/hosts", listHostsHandler);
  router.addRoute("POST", "/v1/hosts", registerHostHandler);

  return router;
}

// ── Main Export ──────────────────────────────────────────────────────

const router = buildRouter();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Upgrade, X-Omnigent-Runner-Token",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Runner tunnel WebSocket - route to Durable Object
    if (url.pathname.startsWith("/v1/runners/") && url.pathname.endsWith("/tunnel")) {
      const runnerId = url.pathname.split("/")[3];
      const doId = env.TUNNEL.idFromName(runnerId);
      const stub = env.TUNNEL.get(doId);
      // Forward to DO with runner_id in URL
      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";
      doUrl.searchParams.set("runner_id", runnerId);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    const response = await router.handle(request, env, ctx);
    if (response) {
      const newResponse = new Response(response.body, response);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newResponse.headers.set(key, value);
      }
      return newResponse;
    }

    // Serve static assets (web UI)
    if (!url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/health")) {
      try {
        return await env.ASSETS.fetch(request);
      } catch {
        // Fall through
      }
    }

    return new Response("Not found", {
      status: 404, headers: corsHeaders,
    });
  },
};
