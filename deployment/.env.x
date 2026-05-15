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
# Empty in v1 (inline retrieval). Set when the MCP server lands.
MCP_URL=

# --- Langfuse (self-hosted, v3) ---------------------------------------------
# Jorick → Langfuse traces. These keys are auto-provisioned by LANGFUSE_INIT_*
# below on first boot of `langfuse-web`, so Jorick can read them directly.
LANGFUSE_PUBLIC_KEY=pk-lf-local-dev
LANGFUSE_SECRET_KEY=sk-lf-local-dev

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
