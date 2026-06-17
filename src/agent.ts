import { Agent, routeAgentRequest } from "agents";
import type { Env } from "./types";

// ── Omnigent Agent ───────────────────────────────────────────────────
// Each session is a Durable Object with embedded SQLite storage.
// Handles: messages, runner connections, state persistence.

interface SessionState {
  agent_id: string;
  title: string;
  runner_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export class OmnigentSession extends Agent<Env, SessionState> {
  // Initialize state and database schema
  async onStart() {
    // Create tables if they don't exist
    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS runners (
        id TEXT PRIMARY KEY,
        name TEXT,
        harnesses TEXT,
        status TEXT DEFAULT 'disconnected',
        connected_at TEXT,
        last_seen TEXT
      )
    `;

    // Initialize state if new
    if (!this.state.agent_id) {
      this.setState({
        agent_id: "",
        title: "",
        runner_id: null,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Handle HTTP requests
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // GET / - Get session info
    if (request.method === "GET" && path === "/") {
      return new Response(JSON.stringify({
        id: this.name,
        ...this.state,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // PATCH / - Update session
    if (request.method === "PATCH" && path === "/") {
      const body = await request.json();
      this.setState({
        ...this.state,
        ...body,
        updated_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify(this.state), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /messages - List messages
    if (request.method === "GET" && path === "/messages") {
      const messages = this.sql`SELECT * FROM messages ORDER BY created_at ASC`;
      return new Response(JSON.stringify({
        object: "list",
        data: messages,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /messages - Add message
    if (request.method === "POST" && path === "/messages") {
      const body = await request.json();
      const id = `msg_${crypto.randomUUID().slice(0, 12)}`;
      const now = new Date().toISOString();

      this.sql`
        INSERT INTO messages (id, role, content, metadata, created_at)
        VALUES (${id}, ${body.role || "user"}, ${body.content}, ${body.metadata || null}, ${now})
      `;

      this.setState({
        ...this.state,
        updated_at: now,
      });

      // Broadcast message to connected clients
      this.broadcast(JSON.stringify({
        type: "message",
        id,
        role: body.role || "user",
        content: body.content,
        created_at: now,
      }));

      // If there's a runner assigned, dispatch to it
      if (this.state.runner_id) {
        this.dispatchToRunner(body.content);
      }

      return new Response(JSON.stringify({ id, ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /runners - List connected runners
    if (request.method === "GET" && path === "/runners") {
      const runners = this.sql`SELECT * FROM runners WHERE status = 'connected'`;
      return new Response(JSON.stringify({
        object: "list",
        data: runners,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  // Handle WebSocket connections
  async onConnect(connection: WebSocket) {
    console.log(`Client connected to session ${this.name}`);

    // Send current state
    connection.send(JSON.stringify({
      type: "state",
      ...this.state,
    }));

    // Send message history
    const messages = this.sql`SELECT * FROM messages ORDER BY created_at ASC`;
    connection.send(JSON.stringify({
      type: "history",
      messages,
    }));
  }

  // Handle WebSocket messages
  async onMessage(connection: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message as string);

      // Client updating state
      if (data.type === "setState") {
        this.setState({
          ...this.state,
          ...data.state,
          updated_at: new Date().toISOString(),
        });
      }

      // Client sending message
      if (data.type === "message") {
        const id = `msg_${crypto.randomUUID().slice(0, 12)}`;
        const now = new Date().toISOString();

        this.sql`
          INSERT INTO messages (id, role, content, metadata, created_at)
          VALUES (${id}, ${data.role || "user"}, ${data.content}, ${data.metadata || null}, ${now})
        `;

        this.setState({
          ...this.state,
          updated_at: now,
        });

        // Broadcast to all clients
        this.broadcast(JSON.stringify({
          type: "message",
          id,
          role: data.role || "user",
          content: data.content,
          created_at: now,
        }));
      }
    } catch (e) {
      console.error("Message parse error:", e);
    }
  }

  // Handle WebSocket close
  async onClose(connection: WebSocket, code: number, reason: string, wasClean: boolean) {
    console.log(`Client disconnected from session ${this.name}`);
  }

  // Dispatch message to assigned runner
  async dispatchToRunner(content: string) {
    // This would send the message to the connected runner
    // For now, just log it
    console.log(`Dispatching to runner ${this.state.runner_id}: ${content}`);
  }

  // Broadcast message to all connected clients
  broadcast(message: string) {
    // The Agent class has built-in broadcast via this.broadcast()
    // But we need to use the connections list
    for (const connection of this.getConnections()) {
      try {
        connection.send(message);
      } catch (e) {
        console.error("Broadcast error:", e);
      }
    }
  }
}

// ── Main Worker ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env) {
    // Route to agent instances
    return (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 });
  },
};
