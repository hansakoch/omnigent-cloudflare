-- Omnigent D1 Database Schema
-- Run with: wrangler d1 execute omnigent-db --file=./schema.sql

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bundle_location TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Sessions/Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT,
  host_id TEXT,
  runner_id TEXT,
  workspace TEXT,
  status TEXT DEFAULT 'active',
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Conversation items (messages)
CREATE TABLE IF NOT EXISTS conversation_items (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user', 'assistant', 'system'
  content TEXT,
  metadata TEXT, -- JSON blob
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Files metadata
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  storage_key TEXT, -- R2 key or artifact path
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Comments (review comments on conversations)
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  item_id TEXT,
  content TEXT NOT NULL,
  author TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Hosts (registered runner hosts)
CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY,
  name TEXT,
  owner TEXT,
  status TEXT DEFAULT 'offline',
  last_seen TEXT,
  capabilities TEXT, -- JSON blob
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Accounts (for multi-user auth)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name TEXT,
  role TEXT DEFAULT 'user', -- 'admin', 'user'
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

-- Sessions auth tokens
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Policies
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  conversation_id TEXT, -- NULL = server-wide default
  name TEXT NOT NULL,
  config TEXT NOT NULL, -- JSON config
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Permissions
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  grantee TEXT NOT NULL, -- email or user id
  permission TEXT NOT NULL, -- 'read', 'write', 'admin'
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Runner tunnel registry (in-memory primarily, but DB for cross-replica)
CREATE TABLE IF NOT EXISTS runner_tunnels (
  runner_id TEXT PRIMARY KEY,
  conversation_id TEXT,
  host_id TEXT,
  status TEXT DEFAULT 'connected',
  connected_at TEXT DEFAULT (datetime('now')),
  last_heartbeat TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (host_id) REFERENCES hosts(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversation_items_conv ON conversation_items(conversation_id);
CREATE INDEX IF NOT EXISTS idx_files_conv ON files(conversation_id);
CREATE INDEX IF NOT EXISTS idx_comments_conv ON comments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_hosts_owner ON hosts(owner);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_policies_conv ON policies(conversation_id);
CREATE INDEX IF NOT EXISTS idx_permissions_conv ON permissions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_runner_tunnels_conv ON runner_tunnels(conversation_id);
