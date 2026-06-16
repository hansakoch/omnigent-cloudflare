# Omnigent Cloudflare

A **full self-contained Omnigent server** running entirely on Cloudflare — Workers, D1, and Durable Objects. No external server needed.

> **Note:** This is an unofficial community contribution, not affiliated with the [Omnigent](https://github.com/omnigent-ai/omnigent) project.

## Prerequisites

Before you begin, you need:

1. **Cloudflare Account** — Free tier works for light usage, Paid plan for custom domains
2. **Domain on Cloudflare** — Your domain must be using Cloudflare nameservers (or you have a zone on your account)
3. **Wrangler CLI** — Install with `npm install -g wrangler`
4. **Node.js 18+** — Required for Wrangler

## Quick Start

```bash
git clone https://github.com/hansakoch/omnigent-cloudflare.git
cd omnigent-cloudflare
chmod +x setup.sh
./setup.sh
```

The setup script will:
- Prompt for your domain name
- Create a D1 database
- Initialize the schema
- Deploy the worker
- Configure your custom domain route

## Security Setup (Required)

This server uses **Cloudflare Access** for authentication — email + one-time PIN protection. No API keys needed.

### Step 1: Go to Cloudflare Zero Trust Dashboard

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **Zero Trust** (left sidebar)
3. If you haven't set up Zero Trust yet, click "Connect" or "Get started"

### Step 2: Create an Access Application

1. Go to **Access** → **Applications**
2. Click **"Add an application"**
3. Choose **"Self-hosted"**
4. Configure:
   - **Application name:** `Omnigent Cloud` (or whatever you prefer)
   - **Session duration:** 24 hours (or your preference)
   - **Application domain:** Enter your domain (e.g., `buildx.yourdomain.com`)
5. Click **"Add application"**

### Step 3: Add an Access Policy

1. After creating the app, go to **Access** → **Policies**
2. Click **"Add a policy"**
3. Configure:
   - **Policy name:** `Allowed Users` (or whatever you prefer)
   - **Action:** Allow
   - **Include rule:**
     - **Selector:** Emails
     - **Value:** Enter the email addresses that should have access (e.g., `you@yourdomain.com`)
4. Click **"Add policy"**

### Step 4: Test Access

1. Visit your domain (e.g., `https://buildx.yourdomain.com`)
2. You should see a Cloudflare Access login page
3. Enter your email address
4. Check your email for a one-time PIN
5. Enter the PIN to access your Omnigent server

### How It Works

- Cloudflare Access runs before your worker
- Users must authenticate with email + PIN
- Only approved email addresses can access the server
- No API keys or passwords to manage
- Sessions are managed by Cloudflare

## What This Gives You

- **D1 Database** — all sessions, agents, messages, hosts stored in D1
- **REST API** — full session/agent/message management
- **WebSocket Tunnels** — runners connect directly to the worker
- **Built-in Web UI** — session management, chat, host monitoring
- **Cloudflare Access** — email + PIN authentication
- **Global Edge** — runs on Cloudflare's network worldwide

## API Endpoints

All endpoints are protected by Cloudflare Access (except health check).

### Health (no auth required)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server health check |
| `GET` | `/health?session_id=<id>` | Session-specific health |

### Agents
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/agents` | List all agents |
| `GET` | `/v1/agents/:id` | Get agent details |

### Sessions
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/sessions` | Create a new session |
| `GET` | `/v1/sessions` | List all sessions |
| `GET` | `/v1/sessions/:id` | Get session details |
| `DELETE` | `/v1/sessions/:id` | Delete a session |

### Messages
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/sessions/:id/messages` | Post a message |
| `GET` | `/v1/sessions/:id/messages` | Get messages |

### Hosts
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/hosts` | List all hosts |
| `POST` | `/v1/hosts` | Register a host |
| `PATCH` | `/v1/hosts/:id` | Update host status |

### WebSocket
| Path | Description |
|------|-------------|
| `GET` | `/v1/runner/tunnel` | Runner WebSocket tunnel |

## Configuration

### Custom Domain

To use a custom domain:

1. Add a CNAME record on your domain:
   ```
   Type: CNAME
   Name: buildx (or whatever subdomain you want)
   Target: your-worker.your-subdomain.workers.dev
   Proxy: Yes (orange cloud)
   ```

2. Update `wrangler.toml` with your domain:
   ```toml
   routes = [
     { pattern = "buildx.yourdomain.com/*", zone_name = "yourdomain.com" }
   ]
   ```

3. Redeploy: `wrangler deploy`

4. Set up Cloudflare Access for your domain (see Security Setup above)

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SERVER_URL` | Your worker URL | Auto-set by setup |

## Cost Estimate

| Component | Cost |
|-----------|------|
| CF Worker | Free tier (100K requests/day) |
| D1 Database | Free tier (5GB storage, 100K reads/day) |
| Cloudflare Access | Free tier (50 users) |
| **Total (light usage)** | **~$0/month** |

## Development

```bash
# Local development
npm install
npx wrangler dev

# Initialize database locally
wrangler d1 execute omnigent-db --file=./schema.sql --local

# Deploy
npx wrangler deploy
```

## File Structure

```
deploy/cloudflare/
├── src/
│   └── index.js          # Main worker (API + WebSocket)
├── public/
│   └── index.html        # Web UI
├── schema.sql            # D1 database schema
├── setup.sh              # One-click setup script
├── wrangler.toml.example # Template (copy to wrangler.toml)
├── package.json          # Dependencies
├── README.md             # This file
├── CONTRIBUTING.md       # Contribution guide
├── SECURITY.md           # Security policy
├── SKILL.md              # Agent skill file
├── LICENSE               # Apache 2.0
└── .gitignore            # Standard ignores
```

## Limitations

- **D1 latency** — D1 is eventually consistent. Cross-region reads may have slight delay.
- **No container support yet** — CF Containers integration is planned but not yet implemented.
- **WebSocket limits** — CF Workers have a 100KB message limit for WebSockets.

## Roadmap

- [ ] CF Containers integration for agent execution
- [ ] R2 storage for file uploads
- [ ] Rate limiting and quotas
- [ ] Session sharing and collaboration

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Test with `wrangler dev`
5. Submit a pull request

## Security

- Authentication is handled by Cloudflare Access
- No API keys or passwords stored in the worker
- Email + PIN one-time authentication
- See [SECURITY.md](SECURITY.md) for details

## License

Apache 2.0 — see [LICENSE](LICENSE).

## Acknowledgments

- [Omnigent](https://github.com/omnigent-ai/omnigent) — the meta-harness for AI agents
- [Cloudflare](https://developers.cloudflare.com/) — Workers, D1, Durable Objects, Access
- Built for the community
