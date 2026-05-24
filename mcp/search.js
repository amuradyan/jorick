import http from 'node:http';
import pg from 'pg';
import pgvector from 'pgvector';
import { pipeline, env } from '@huggingface/transformers';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

env.cacheDir = '/app/.cache';

const PORT = Number(process.env.PORT) || 9000;

// BGE-v1.5 requires this prefix on query embeddings (no prefix on documents).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

const extractor = await pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function searchPassages(query, k) {
  const output = await extractor([QUERY_PREFIX + query], {
    pooling: 'mean',
    normalize: true,
  });
  const vec = output.tolist()[0];

  const { rows } = await db.query(
    `SELECT play, act, scene, speaker, text
       FROM passages
   ORDER BY embedding <=> $1
      LIMIT $2`,
    [pgvector.toSql(vec), k],
  );
  return rows;
}

function makeServer() {
  const mcp = new McpServer({ name: 'jorick-search', version: '0.1.0' });
  mcp.registerTool(
    'search_passages',
    {
      description: 'Vector-search Shakespeare passages by natural-language query. Returns the top-k passages ordered by cosine distance to the query embedding.',
      inputSchema: {
        query: z.string().describe('Natural-language search query.'),
        k: z.number().int().min(1).default(3).describe('How many passages to return.'),
      },
    },
    async ({ query, k }) => {
      const passages = await searchPassages(query, k);
      return { content: [{ type: 'text', text: JSON.stringify(passages) }] };
    },
  );
  return mcp;
}

const transports = new Map();
const streamableTransports = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      transport.onclose = () => transports.delete(transport.sessionId);
      await makeServer().connect(transport);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId && transports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('unknown sessionId');
      }
      return transport.handlePostMessage(req, res);
    }

    if (url.pathname === '/mcp') {
      const existingId = req.headers['mcp-session-id'];
      let transport = typeof existingId === 'string' && streamableTransports.get(existingId);
      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => streamableTransports.set(id, transport),
          onsessionclosed: (id) => streamableTransports.delete(id),
        });
        transport.onclose = () => {
          if (transport.sessionId) streamableTransports.delete(transport.sessionId);
        };
        await makeServer().connect(transport);
      }
      return transport.handleRequest(req, res);
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('mcp-search endpoints: GET /sse, POST /messages, POST /mcp');
  } catch (err) {
    console.error('mcp-search request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err.message || err));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => console.log(`mcp-search on ${PORT} (SSE: /sse + /messages, Streamable HTTP: /mcp)`));
