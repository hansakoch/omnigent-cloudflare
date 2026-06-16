#!/bin/bash
# Omnigent Cloudflare - Setup Script
# Run this to initialize the D1 database and deploy the worker

set -e

echo "=== Omnigent Cloudflare Setup ==="
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo "Installing wrangler..."
  npm install -g wrangler
fi

# Check if logged in
if ! wrangler whoami &> /dev/null 2>&1; then
  echo "Please login to Cloudflare..."
  wrangler login
fi

# Prompt for domain name
echo ""
echo "Enter your custom domain (e.g., buildx.example.com)"
echo "Press Enter to skip and use workers.dev subdomain"
read -p "Domain: " CUSTOM_DOMAIN

echo ""
echo "Step 1: Create D1 Database"
echo "---"
DB_OUTPUT=$(wrangler d1 create omnigent-db 2>&1)
echo "$DB_OUTPUT"

# Extract database ID
DB_ID=$(echo "$DB_OUTPUT" | grep -oP 'database_id = "\K[^"]+')
if [ -z "$DB_ID" ]; then
  echo "ERROR: Could not extract database ID"
  echo "Please manually update wrangler.toml with your database_id"
  exit 1
fi

echo ""
echo "Database ID: $DB_ID"

# Create wrangler.toml from template
echo ""
echo "Step 2: Configure wrangler.toml"
echo "---"

# Get worker name
WORKER_NAME="omnigent-cloudflare"

# Build wrangler.toml
cat > wrangler.toml << EOF
name = "$WORKER_NAME"
main = "src/index.js"
compatibility_date = "2026-06-16"
workers_dev = true

EOF

# Add custom domain route if provided
if [ -n "$CUSTOM_DOMAIN" ]; then
  # Extract the subdomain and root domain
  SUBDOMAIN=$(echo "$CUSTOM_DOMAIN" | cut -d'.' -f1)
  ROOT_DOMAIN=$(echo "$CUSTOM_DOMAIN" | cut -d'.' -f2-)
  
  echo "Adding route for $CUSTOM_DOMAIN..."
  cat >> wrangler.toml << EOF
# Custom Domain
routes = [
  { pattern = "$CUSTOM_DOMAIN/*", zone_name = "$ROOT_DOMAIN" }
]

EOF

  # Add CNAME instructions
  echo ""
  echo "=== DNS Setup Required ==="
  echo "Add this CNAME record to your domain:"
  echo "  Type: CNAME"
  echo "  Name: $SUBDOMAIN"
  echo "  Target: $WORKER_NAME.<your-cloudflare-subdomain>.workers.dev"
  echo "  Proxy: Yes (orange cloud)"
  echo ""
fi

# Add D1 config
cat >> wrangler.toml << EOF
# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "omnigent-db"
database_id = "$DB_ID"

# Static Assets (Web UI)
[assets]
directory = "./public"
binding = "ASSETS"

# Environment Variables
[vars]
EOF

# Set SERVER_URL after deploy (we'll update it later)
echo ""
echo "Step 3: Initialize Database Schema"
echo "---"
wrangler d1 execute omnigent-db --file=./schema.sql
wrangler d1 execute omnigent-db --file=./schema.sql --remote

echo ""
echo "Step 4: Deploy Worker"
echo "---"
DEPLOY_OUTPUT=$(wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"

# Extract worker URL
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oP 'https://[^\s]+' | head -1)

if [ -z "$WORKER_URL" ]; then
  WORKER_URL="https://$WORKER_NAME.<your-subdomain>.workers.dev"
fi

# Update SERVER_URL in wrangler.toml
echo "SERVER_URL = \"$WORKER_URL\"" >> wrangler.toml

# Redeploy with SERVER_URL
wrangler deploy > /dev/null 2>&1

echo ""
echo "Step 5: Seed Agents"
echo "---"
wrangler d1 execute omnigent-db --remote --command "
INSERT OR IGNORE INTO agents (id, name, version) VALUES 
  ('agent_codex', 'Codex', 1),
  ('agent_pi', 'Pi Coding Agent', 1),
  ('agent_freebuff', 'Freebuff', 1),
  ('agent_mimo', 'MiMo Code', 1),
  ('agent_polly', 'Polly (Multi-Agent)', 1),
  ('agent_debby', 'Debby (Brainstorm)', 1);
"

echo ""
echo "=== Setup Complete ==="
echo ""
if [ -n "$CUSTOM_DOMAIN" ]; then
  echo "Custom Domain: https://$CUSTOM_DOMAIN"
fi
echo "Worker URL: $WORKER_URL"
echo ""
echo "=== Security Setup (Required) ==="
echo ""
echo "You MUST set up Cloudflare Access to protect your server:"
echo ""
echo "1. Go to: https://dash.cloudflare.com → Zero Trust"
echo "2. Go to Access → Applications → Add an application"
echo "3. Choose 'Self-hosted'"
echo "4. Set Application domain to: $CUSTOM_DOMAIN (or your worker URL)"
echo "5. Go to Access → Policies → Add a policy"
echo "6. Set Action: Allow, Selector: Emails, Value: your-email@domain.com"
echo "7. Save and test by visiting your domain"
echo ""
echo "This gives you email + PIN login protection."
echo ""
echo "Next steps:"
echo "1. If using custom domain, add the CNAME record shown above"
echo "2. Set up Cloudflare Access (instructions above)"
echo "3. Open the web UI:"
if [ -n "$CUSTOM_DOMAIN" ]; then
  echo "   https://$CUSTOM_DOMAIN"
else
  echo "   $WORKER_URL"
fi
echo "4. Login with your email + PIN"
