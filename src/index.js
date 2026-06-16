// Omnigent Cloudflare Worker - Self-contained server
//
// Full port of the Omnigent Python FastAPI server to Cloudflare Workers + D1.

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

async function healthHandler(req, env) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");

  const result = { status: "ok" };

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
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(agent), {
    headers: { "Content-Type": "application/json" },
  });
}

async function createSessionHandler(req, env) {
  const body = await req.json();

  const sessionId = `conv_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO conversations (id, agent_id, title, workspace, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).bind(sessionId, body.agent_id, body.title || null, body.workspace || null, now, now).run();

  const session = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?")
    .bind(sessionId).first();

  return new Response(JSON.stringify(session), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

async function listSessionsHandler(req, env) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const sessions = await env.DB.prepare(
    "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?"
  ).bind(limit, offset).all();

  return new Response(JSON.stringify(sessions.results), {
    headers: { "Content-Type": "application/json" },
  });
}

async function getSessionHandler(req, env) {
  const session = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?")
    .bind(req.params.id).first();

  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(session), {
    headers: { "Content-Type": "application/json" },
  });
}

async function deleteSessionHandler(req, env) {
  await env.DB.prepare("DELETE FROM conversations WHERE id = ?")
    .bind(req.params.id).run();

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function postMessageHandler(req, env) {
  const body = await req.json();

  const itemId = `item_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO conversation_items (id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(itemId, req.params.id, body.role || "user", body.content, now).run();

  await env.DB.prepare(
    "UPDATE conversations SET updated_at = ? WHERE id = ?"
  ).bind(now, req.params.id).run();

  return new Response(JSON.stringify({ id: itemId, ok: true }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

async function listMessagesHandler(req, env) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100");

  const messages = await env.DB.prepare(
    "SELECT * FROM conversation_items WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?"
  ).bind(req.params.id, limit).all();

  return new Response(JSON.stringify(messages.results), {
    headers: { "Content-Type": "application/json" },
  });
}

// ── Host Management ──────────────────────────────────────────────────

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
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

async function updateHostStatusHandler(req, env) {
  const body = await req.json();
  const now = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE hosts SET status = ?, last_seen = ?, updated_at = ? WHERE id = ?"
  ).bind(body.status, now, now, req.params.id).run();

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

// ── Runner Tunnel (WebSocket) ────────────────────────────────────────

async function tunnelHandler(req, env) {
  const upgradeHeader = req.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const url = new URL(req.url);
  const runnerId = url.searchParams.get("runner_id") || `runner_${crypto.randomUUID().slice(0, 8)}`;
  const conversationId = url.searchParams.get("conversation_id");

  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];

  server.accept();

  // Register runner
  if (conversationId) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO runner_tunnels (runner_id, conversation_id, status, connected_at)
       VALUES (?, ?, 'connected', datetime('now'))`
    ).bind(runnerId, conversationId).run();

    await env.DB.prepare(
      "UPDATE conversations SET runner_id = ? WHERE id = ?"
    ).bind(runnerId, conversationId).run();
  }

  server.addEventListener("message", async (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "message" && conversationId) {
        const itemId = `item_${crypto.randomUUID().slice(0, 12)}`;
        await env.DB.prepare(
          `INSERT INTO conversation_items (id, conversation_id, role, content, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(itemId, conversationId, data.role || "assistant", data.content || "").run();
      }
    } catch (e) {
      console.error("Tunnel message error:", e);
    }
  });

  server.addEventListener("close", async () => {
    if (conversationId) {
      await env.DB.prepare(
        "UPDATE runner_tunnels SET status = 'disconnected' WHERE runner_id = ?"
      ).bind(runnerId).run();

      await env.DB.prepare(
        "UPDATE conversations SET runner_id = NULL WHERE id = ?"
      ).bind(conversationId).run();
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

// ── Build Router ─────────────────────────────────────────────────────

function buildRouter() {
  const router = new Router();

  router.addRoute("GET", "/health", healthHandler);
  router.addRoute("GET", "/v1/agents", listAgentsHandler);
  router.addRoute("GET", "/v1/agents/{id}", getAgentHandler);
  router.addRoute("POST", "/v1/sessions", createSessionHandler);
  router.addRoute("GET", "/v1/sessions", listSessionsHandler);
  router.addRoute("GET", "/v1/sessions/{id}", getSessionHandler);
  router.addRoute("DELETE", "/v1/sessions/{id}", deleteSessionHandler);
  router.addRoute("POST", "/v1/sessions/{id}/messages", postMessageHandler);
  router.addRoute("GET", "/v1/sessions/{id}/messages", listMessagesHandler);
  router.addRoute("GET", "/v1/hosts", listHostsHandler);
  router.addRoute("POST", "/v1/hosts", registerHostHandler);
  router.addRoute("PATCH", "/v1/hosts/{id}", updateHostStatusHandler);
  router.addRoute("GET", "/v1/runner/tunnel", tunnelHandler);

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
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Auth is handled by Cloudflare Access (email + pin)
    // No API key check needed - Cloudflare Access protects the worker

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
      status: 404,
      headers: corsHeaders,
    });
  },
};
