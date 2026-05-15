# 🎭 Jorick

> ˈʒɔːrɪk - *j* as in French *Jean* \ *Jacques*

A Q&A agent built mostly around Shakespeares' original works with a few alterations, as a hands-on vehicle for learning the agentic-AI toolchain — LangChain.js, MCP, RAG, Langfuse, observability, MS Foundry, n8n.

## Status

| Layer | State |
|---|---|
| Corpus download (Folger TEI via DraCor mirror) | ✅ working |
| Schema + pgvector store | ✅ working |
| Embedding ingestion (Transformers.js + bge-large) | ✅ working |
| Jorick agent (LangChain.js) | ⏳ planned |
| Web UI (vanilla HTML+JS) | ⏳ planned |
| MCP retrieval boundary | ⏳ planned |
| Langfuse self-hosted observability | ⏳ planned |
| Kubernetes deployment (k3d) | ⏳ deferred |

Architecture, decisions, and remaining work live in [`notes/braindump.md`](notes/braindump.md).

## Stack constraint

JS + Node, end-to-end. No Python. The embedder uses Transformers.js loading the ONNX build of `Xenova/bge-large-en-v1.5` so ingestion and query-time embedding share a single Node runtime.

## Quick start

All docker commands run from the `deployment/` directory:

```bash
cd deployment
cp .env.x .env                # local-dev defaults (Postgres creds, placeholders for API keys)
docker compose up             # downloads corpus → applies schema → embeds → exits ingest
```

First run takes ~5 minutes (image build with pre-cached embedding model) plus ~10 minutes (CPU embedding of 5 plays). Subsequent `compose up`s are fast — services are idempotent.

Confirm it worked:

```bash
docker compose exec postgres psql -U jorick -d jorick \
  -c "SELECT play, count(*) FROM passages GROUP BY play ORDER BY play;"
```

Should show five plays with a few hundred to ~1,500 passages each.

To wipe everything (volumes too): `docker compose down -v`.

## Services

| Service | Role | Lifetime |
|---|---|---|
| `postgres` | pgvector on Postgres 17, exposed on host `localhost:5433` | long-running |
| `migrate` | applies `schema.sql` (idempotent) | one-shot |
| `download` | fetches Shakespeare TEI XML from [dracor-org/shakedracor](https://github.com/dracor-org/shakedracor) into `./data/` (idempotent, skips existing files) | one-shot |
| `ingest` | parses XML by speech, embeds each passage, inserts into `passages` | one-shot |

`migrate`, `download`, `ingest` declare `depends_on` with `service_completed_successfully` so a single `docker compose up` orchestrates the chain deterministically.

## Repository layout

```
.
├── functions/                # Node scripts
│   ├── ingest-corpus.js      # TEI parser → embed → INSERT
│   └── download-corpus.js    # DraCor corpus fetcher
├── deployment/          # docker, env, SQL
│   ├── compose.yml      # service stack
│   ├── Dockerfile       # node:22-slim + Transformers.js + pre-cached BGE model
│   ├── .env.x           # env template (copy to deployment/.env)
│   ├── schema.sql       # passages table + HNSW vector index
│   └── corrupt.sql      # RAG-validation corruption (opt-in)
├── package.json
├── data/                # corpus XMLs (gitignored except .gitkeep)
└── notes/               # architecture braindump, design notes
```

## Corpus source

Folger Digital Texts TEI XML via the [dracor-org/shakedracor](https://github.com/dracor-org/shakedracor) GitHub mirror. CC BY-NC 3.0 — original Folger license. Starter set (configurable in `functions/download-corpus.js`): Hamlet, Othello, Macbeth, King Lear, Romeo and Juliet.

## Embedding model

`Xenova/bge-large-en-v1.5` (1024-d, ONNX build of BAAI's BGE-large). Loaded via `@huggingface/transformers` in Node. Pre-cached into the Docker image during build so first runs don't redownload ~1.3 GB.

The same model will be used at query time (inside the MCP server, when that lands) so ingest-side and query-side vectors live in the same space. Changing the model means re-embedding the entire corpus.

## Verifying RAG is actually grounding answers

A built-in smoke test, applied once Jorick is online: corrupt the corpus in pgvector with character renames and Yoda-style line reorderings, then ask Jorick about things that are famous from Shakespeare's training data. If Jorick answers from the corrupted corpus, retrieval is doing real work; if it answers with canonical Shakespeare, the model is leaning on training-data memory and RAG is broken (or being ignored).

The rename list (in [`notes/braindump.md`](notes/braindump.md), section *On how to know this worked*) is structured so each character pair has *one renamed* and *one left as-is* — so queries that name an unrenamed character naturally pull in passages mentioning the renamed counterpart:

| Query | Expected answer if RAG is grounding | Canonical (training-data) answer |
|---|---|---|
| *Who was Juliet's beloved?* | **Renato** | Romeo |
| *Who was the king in King Lear?* | **Kong** | Lear |
| *Who is Macbeth's wife?* | **Mrs M** | Lady Macbeth |
| *Who advises young Hamlet?* | **Telman** | Polonius |
| *Who is Othello's ensign?* | **Jafar** | Iago |
