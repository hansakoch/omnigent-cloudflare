import { routeAgentRequest } from "agents";
import type { Env } from "./types";

// ── Main Worker ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Route to Agent instances (WebSocket and HTTP)
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    // API routes for session management
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // Static assets
    if (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
      try {
        return await env.ASSETS.fetch(request);
      } catch {}
    }

    return new Response("Not found", { status: 404 });
  },
};

// ── API Handler ──────────────────────────────────────────────────────

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // GET /api/sessions - List all sessions
  if (request.method === "GET" && path === "/api/sessions") {
    const sessions = env.DB.prepare(
      "SELECT * FROM conversations ORDER BY updated_at DESC"
    ).all();

    const result = await sessions;
    return new Response(JSON.stringify({
      object: "list",
      data: result.results,
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // POST /api/sessions - Create session
  if (request.method === "POST" && path === "/api/sessions") {
    const body = await request.json();
    const id = body.id || `session-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO conversations (id, agent_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`
    ).bind(id, body.agent_id || "default", body.title || "New Session", now, now).run();

    return new Response(JSON.stringify({ id, ok: true }), {
      status: 201,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // DELETE /api/sessions/:id - Delete session
  if (request.method === "DELETE" && path.startsWith("/api/sessions/")) {
    const id = path.split("/")[3];
    await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response("Not found", { status: 404, headers: corsHeaders });
}
