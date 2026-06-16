# Omnigent Cloudflare Server

## Purpose

Deploy a self-contained Omnigent server on Cloudflare Workers + D1. Provides REST API, WebSocket tunnels, and web UI for AI agent orchestration.

## When to Use

- Deploying an Omnigent server to Cloudflare
- Running a serverless agent orchestration platform
- Enabling multi-device access to agent sessions
- Zero-infrastructure server deployment

## Setup

### Prerequisites

1. Cloudflare account
2. Domain on Cloudflare
3. Wrangler CLI (`npm install -g wrangler`)
4. Node.js 18+

### Deploy

```bash
cd deploy/cloudflare

# One-click setup
chmod +x setup.sh
./setup.sh
```

Or manually:
```bash
# Create database
wrangler d1 create omnigent-db

# Update wrangler.toml with database_id

# Initialize schema
wrangler d1 execute omnigent-db --file=./schema.sql
wrangler d1 execute omnigent-db --file=./schema.sql --remote

# Deploy
wrangler deploy
```

### Security Setup

Set up Cloudflare Access for email + PIN protection:

1. Go to Cloudflare Zero Trust Dashboard
2. Create Access Application for your domain
3. Add policy with email addresses allowed
4. Users login with email + one-time PIN

## Usage

### Health Check

```bash
curl https://your-domain.com/health
```

### List Agents

```bash
curl https://your-domain.com/v1/agents
```

### Create Session

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"agent_id": "agent_mimo", "title": "My session"}' \
  https://your-domain.com/v1/sessions
```

### Post Message

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"content": "Hello, agent!", "role": "user"}' \
  https://your-domain.com/v1/sessions/SESSION_ID/messages
```

### WebSocket Tunnel

Connect via WebSocket:
```javascript
const ws = new WebSocket('wss://your-domain.com/v1/runner/tunnel?runner_id=my-runner&conversation_id=conv_xxx');
```

## Key Files

- `src/index.js` — Worker code (API + WebSocket + routing)
- `schema.sql` — D1 database schema
- `public/index.html` — Web UI
- `wrangler.toml` — CF Worker configuration
- `setup.sh` — One-click setup script

## Notes

- D1 is eventually consistent (slight delay for cross-region reads)
- WebSocket messages limited to 100KB
- Free tier covers light usage (~100K requests/day)
- Authentication handled by Cloudflare Access

## Troubleshooting

### Database errors
- Check `wrangler.toml` has correct `database_id`
- Run schema initialization again

### Access issues
- Verify Cloudflare Access is configured
- Check allowed email addresses in policy
- Ensure domain is proxied (orange cloud)

### WebSocket issues
- Ensure URL uses `wss://` (not `ws://`)
- Check query parameters: `runner_id` and `conversation_id`
