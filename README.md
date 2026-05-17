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
| Langfuse self-hosted observability | ⏳ planned |
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

Switch engines via env: `ENGINE=anthropic ./jorick up` runs the simpler MCP-client + Anthropic-SDK path; default is `agent-sdk` (Claude Agent SDK with MCP via `mcpServers`).

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
│       └── engines/
│           ├── agent-sdk.js  # Claude Agent SDK loop (query() with mcpServers)
│           └── anthropic.js  # MCP client + Anthropic SDK (one-shot retrieve-then-prompt)
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
