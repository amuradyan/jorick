# ----------------------------------------------------------------------------
# Jorick local-dev environment template. Copy to `.env` and fill in blanks.
# `compose.yml` interpolates these via ${VAR}. Single source of truth.
# ----------------------------------------------------------------------------

# --- Postgres (Jorick's pgvector DB) ----------------------------------------
POSTGRES_USER=jorick
POSTGRES_PASSWORD=jorick
POSTGRES_DB=jorick
POSTGRES_PORT=5433

# Derived from the above. For host-side runs (`node ingest.js …`) only;
# inside compose, services build their own DSN against the `postgres` host.
DATABASE_URL=postgresql://jorick:jorick@localhost:5433/jorick

# --- Anthropic --------------------------------------------------------------
# Required by Jorick.
ANTHROPIC_API_KEY=

# --- MCP server -------------------------------------------------------------
# In-compose URL. Leave as default unless pointing Jorick at an external MCP.
MCP_URL=http://mcp-search:9000/sse

# --- Engine -----------------------------------------------------------------
# Which /ask backend to use: `agent-sdk` (Claude Agent SDK + mcpServers) or
# `anthropic` (direct Anthropic SDK with hand-rolled MCP client call).
ENGINE=agent-sdk

# --- Langfuse (self-hosted, v3) ---------------------------------------------
# Jorick → Langfuse traces. These keys come from the Langfuse UI on first boot
# (org → project → API keys).
LANGFUSE_PUBLIC_KEY=pk-lf-local-dev
LANGFUSE_SECRET_KEY=sk-lf-local-dev
# Reached from inside the jorick container via the shared `jorick-langfuse`
# external docker network (declared in compose.yml). Service name = hostname.
LANGFUSE_BASE_URL=http://langfuse-web:3000

# Cryptographic material. Generate once and keep stable across restarts.
#   openssl rand -hex 32          → LANGFUSE_SALT (32+ hex)
#   openssl rand -hex 32          → LANGFUSE_ENCRYPTION_KEY (exactly 64 hex)
#   openssl rand -base64 32       → LANGFUSE_NEXTAUTH_SECRET
LANGFUSE_SALT=
LANGFUSE_ENCRYPTION_KEY=
LANGFUSE_NEXTAUTH_SECRET=

# Bootstrap admin account (created on first boot only).
LANGFUSE_INIT_USER_EMAIL=admin@jorick.local
LANGFUSE_INIT_USER_PASSWORD=changeme

# Internal stack creds (local-only, behind compose network).
LANGFUSE_POSTGRES_PASSWORD=langfuse
CLICKHOUSE_PASSWORD=clickhouse
REDIS_PASSWORD=redis
MINIO_ROOT_PASSWORD=miniominio
