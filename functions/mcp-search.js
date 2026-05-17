import http from 'node:http';
import pg from 'pg';
import pgvector from 'pgvector';
import { pipeline, env } from '@huggingface/transformers';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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

const transports = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      transport.onclose = () => transports.delete(transport.sessionId);
      await mcp.connect(transport);
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

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('mcp-search endpoints: GET /sse, POST /messages');
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

server.listen(PORT, () => console.log(`mcp-search on ${PORT}`));
