# 🎭 Jorick

> ˈʒɔːrɪk - *j* as in French *Jean* \ *Jacques*

A Q&A agent built mostly around Shakespeares' original works with a few alterations, as a hands-on vehicle for practicing the agentic-AI toolchain — LangChain.js, MCP, RAG, Langfuse, observability, MS Foundry, n8n, and all that along with deployments aka dockers and k8ss.

## Status

| Layer | State |
| --- | --- |
| Corpus download (Folger TEI via DraCor mirror) | ✅ working |
| Schema + pgvector store | ✅ working |
| Embedding ingestion (Transformers.js + bge-large) | ✅ working |
| Jorick agent (Claude Agent SDK + Anthropic SDK, engine-switchable via `ENGINE` env) | ✅ working |
| Web UI (vanilla HTML+JS) | ✅ working |
| MCP retrieval boundary | ✅ working |
| Langfuse self-hosted observability | ✅ working (OTel-based, separate compose project; see [Observability](#observability)) |
| Kubernetes deployment (k3d) | ⏳ deferred |

/messy/ Architecture, decisions, and remaining work and notes for now live in [`notes/braindump.md`](notes/braindump.md).

## Stack constraint

JS + Node, end-to-end. No Python. The embedder uses Transformers.js loading the ONNX build of `Xenova/bge-large-en-v1.5` so ingestion and query-time embedding share a single Node runtime.

## Quick start

All docker commands run from the `deployment/` directory:

```bash
cd deployment
cp .env.x .env                # then edit .env to set ANTHROPIC_API_KEY
docker compose up             # downloads corpus → applies schema → embeds → corrupts → starts Jorick on :8080
```

Compose creates a `jorick-langfuse` docker network on first `up`. The Langfuse stack (optional — see [Observability](#observability)) attaches to that same network as external. Langfuse credentials are also optional: Jorick degrades gracefully when they're absent.

On my  13th Gen Intel i9-13980HX (32) @ 5.400GHz with more than enough RAM the first run takes ~5 minutes (image build with pre-cached embedding model) plus ~25 minutes (CPU embedding of 5 plays) plus ~1 minute (corruption SQL). Subsequent `compose up`s are fast — services are idempotent.

Confirm it worked:

```bash
docker compose exec postgres psql -U jorick -d jorick \
  -c "SELECT play, count(*) FROM passages GROUP BY play ORDER BY play;"
```

Should show five plays with a few hundred to ~1,500 passages each.

To wipe everything (volumes too): `docker compose down -v`.

## Dev loop

After the initial setup, use `./jorick` for day-to-day. It wraps `docker compose` so the fast path is the default and a re-ingest only happens when you explicitly ask for one.

| Command | Action |
| --- | --- |
| `./jorick up` | Bring Jorick back up. `--no-deps`, no ingest re-run. |
| `./jorick up --build` | Rebuild Jorick's image, then up. For code changes. |
| `./jorick reset` | Wipe `pgdata` + re-run the full chain (~25 min – ~2 hours). |
| `./jorick logs` | Tail Jorick's container logs. |
| `./jorick ps` | Show running containers. |
| `./jorick psql [args]` | Open a psql shell against pgvector. |
| `./jorick ask "..."` | POST a question and stream the answer to stdout. |

`./jorick help` prints the full list.

Switch engines via env. Default is `agent-sdk` (Claude Agent SDK with MCP via `mcpServers`). Other options: `ENGINE=anthropic ./jorick up` (simpler MCP-client + Anthropic-SDK path) and `ENGINE=deep ./jorick up` (LangChain's DeepAgents on LangGraph, MCP via `@langchain/mcp-adapters`).

For verbose OTel/span-export logs from inside Jorick's container, set `OTEL_DEBUG=1` in `.env`.

## Services

When we do `docker compose up`, these services run:

```plain
                      +---> migrate ---+
postgres --[healthy]--|                |--[both exit 0]--> ingest --[exit 0]--> corrupt --[exit 0]--> mcp-search --[started]--> jorick
                      +--> download ---+
```

| Service | Role | Lifetime |
| --- | --- | --- |
| `postgres` | pgvector on Postgres 17, exposed on host `localhost:5433` | long-running |
| `migrate` | applies `schema.sql` (idempotent) | one-shot |
| `download` | fetches Shakespeare TEI XML from [dracor-org/shakedracor](https://github.com/dracor-org/shakedracor) into `./data/` (idempotent, skips existing files) | one-shot |
| `ingest` | parses XML by speech, embeds each passage, inserts into `passages` | one-shot |
| `corrupt` | applies `corrupt.sql` to rewrite the `passages` table with character renames and Yoda-style line reorderings; runs after `ingest` (idempotent — no-op once corrupted) | one-shot |
| `mcp-search` | MCP server exposing the `search_passages` tool over HTTP+SSE on `:9000`; owns the BGE embedder and the pgvector read path | long-running |
| `jorick` | serves the chat page on `localhost:8080`; runs an agent loop via the Claude Agent SDK that calls `search_passages` on `mcp-search` and streams tokens back as SSE | long-running |

## Repository layout

```plain
.
├── jorick                    # dev-loop CLI (bash, wraps docker compose)
├── functions/
│   ├── ingest-corpus.js      # TEI parser → embed → INSERT
│   ├── download-corpus.js    # DraCor corpus fetcher
│   └── jorick/
│       ├── index.js          # HTTP server + SSE framing + engine dispatch (ENGINE env)
│       ├── observability.js  # @opentelemetry/sdk-node + LangfuseSpanProcessor; graceful no-op if creds missing
│       └── engines/
│           ├── agent-sdk.js  # Claude Agent SDK loop (query() with mcpServers)
│           ├── anthropic.js  # MCP client + Anthropic SDK (one-shot retrieve-then-prompt)
│           └── deep.js       # LangChain DeepAgents on LangGraph (@langchain/mcp-adapters)
├── mcp/
│   └── search.js             # MCP server: BGE embedder + pgvector + search_passages tool
├── public/
│   └── index.html            # vanilla HTML+JS chat page
├── deployment/
│   ├── compose.yml           # service stack
│   ├── Dockerfile            # node:22-slim + Transformers.js + pre-cached BGE model
│   ├── .env.x                # env template (copy to deployment/.env)
│   ├── schema.sql            # passages table + HNSW vector index
│   └── corrupt.sql           # RAG-validation corruption applied after ingest
├── package.json
├── data/                     # corpus XMLs (gitignored except .gitkeep)
└── notes/                    # architecture braindump, design notes
```

## Corpus source

Folger Digital Texts TEI XML via the [dracor-org/shakedracor](https://github.com/dracor-org/shakedracor) GitHub mirror. CC BY-NC 3.0 — original Folger license. Starter set (configurable in `functions/download-corpus.js`): Hamlet, Othello, Macbeth, King Lear, Romeo and Juliet.

## Embedding model

`Xenova/bge-large-en-v1.5` (1024-d, ONNX build of BAAI's BGE-large). Loaded via `@huggingface/transformers` in Node. Pre-cached into the Docker image during build so first runs don't redownload ~1.3 GB.

The same model is used at query time inside the `mcp-search` service, so ingest-side and query-side vectors live in the same space.

**!** Changing the model means re-embedding the entire corpus.

## Observability

Each `POST /ask` becomes one Langfuse trace with a child `generation` capturing the LLM call (model, input, output, token usage). The retrieved passages land as metadata on the trace; the engine name (`agent-sdk` or `anthropic`) lands too.

Langfuse runs as a **separate docker-compose project** ([self-hosting docs](https://langfuse.com/self-hosting/docker-compose)) and Jorick reaches it through a shared `jorick-langfuse` docker network — same network created in the Quick start.

Set the project-scoped keys in `deployment/.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=http://langfuse-web:3000   # service name on the shared network
```

If any of the three are missing, Jorick logs `langfuse: missing credentials, tracing disabled` at boot and continues normally — `/ask` keeps working without traces.

To attach the Langfuse stack to the same network, add to its `docker-compose.yml`:

```yaml
services:
  langfuse-web:
    networks: [default, jorick-langfuse]
networks:
  jorick-langfuse:
    external: true
```

Then start the full Langfuse stack (`langfuse-web` + `langfuse-worker` + the three datastores). The **worker** is required for traces to land in ClickHouse and become visible in the UI — without it, spans accumulate in Redis and the UI stays empty.

## Verifying RAG is actually grounding answers

A built-in smoke test, applied automatically as part of `compose up`: after ingest finishes, the `corrupt` service rewrites the `passages` table with character renames and Yoda-style line reorderings. Once Jorick is online, open `http://localhost:8080` and ask it about things that are famous from Shakespeare's training data. If Jorick answers from the corrupted corpus, retrieval is doing real work; if it answers with canonical Shakespeare, the model is leaning on training-data memory and RAG is broken (or being ignored).

The rename list (in [`notes/braindump.md`](notes/braindump.md), section *On how to know this worked*) is structured so each character pair has *one renamed* and *one left as-is* — so queries that name an unrenamed character naturally pull in passages mentioning the renamed counterpart:

| Query | Expected answer if RAG is grounding | Canonical (training-data) answer |
| --- | --- | --- |
| *Who was Juliet's beloved?* | **Renato** | Romeo |
| *Who was the king in King Lear?* | **Kong** | Lear |
| *Who is Macbeth's wife?* | **Mrs M** | Lady Macbeth |
| *Who advises young Hamlet?* | **Telman** | Polonius |
| *Who is Othello's ensign?* | **Jafar** | Iago |

## Troubleshooting

**Containers in a weird state, data fine.** `./jorick up` rebuilds the runtime side without re-running the ingest chain. If that's not enough:

```bash
docker compose -f deployment/compose.yml down
./jorick up
```

Volumes survive — embeddings, Langfuse data, all intact.

**Stale `jorick-langfuse` network** (e.g. compose complains the network exists "but was not created by compose" — happens once when upgrading from the previous external-network setup):

```bash
docker compose -f deployment/compose.yml down
docker compose -f /path/to/langfuse/docker-compose.yml down
docker network rm jorick-langfuse
./jorick up
cd /path/to/langfuse && docker compose up -d
```

**Full reset, embeddings included.** `./jorick reset` wipes `pgdata` and re-runs the entire ingest chain. ~25 min to ~2 hours of CPU depending on contention. Use only when you actually want fresh data.
