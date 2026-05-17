import http from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import pgvector from 'pgvector';
import { pipeline, env } from '@huggingface/transformers';
import Anthropic from '@anthropic-ai/sdk';

env.cacheDir = '/app/.cache';

const PORT = Number(process.env.PORT) || 8080;
const EXO_NAME = process.env.EXO || 'jorick';
const exo = JSON.parse(await readFile(`./exo/${EXO_NAME}.json`, 'utf8'));

// BGE-v1.5 requires this prefix on query embeddings (no prefix on documents).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

const extractor = await pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const anthropic = new Anthropic();

async function searchPassages(query, k = exo.topK) {
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

function formatPassages(passages) {
  return passages
    .map(p => p.speaker
      ? `[${p.play} ${p.act}.${p.scene}, ${p.speaker}] ${p.text}`
      : `[${p.play} ${p.act}.${p.scene}] ${p.text}`)
    .join('\n\n');
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => s += c);
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      const html = await readFile('./public/index.html');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'POST' && req.url === '/ask') {
      const { question } = JSON.parse(await readBody(req));
      if (!question || typeof question !== 'string') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unable to comprehend the question' }));
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      });

      const passages = await searchPassages(question);
      res.write(`event: passages\ndata: ${JSON.stringify(passages)}\n\n`);

      const stream = anthropic.messages.stream({
        model: 'claude-opus-4-7',
        max_tokens: 1024,
        system: exo.systemPrompt,
        messages: [{
          role: 'user',
          content: `Passages:\n${formatPassages(passages)}\n\nQuestion: ${question}`,
        }],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          res.write(`data: ${JSON.stringify(event.delta.text)}\n\n`);
        }
      }

      res.write(`event: done\ndata: {}\n\n`);
      return res.end();
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('It\'s either `GET /` or `POST /ask`, friend.');
  } catch (err) {
    console.error('request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => console.log(`jorick on ${PORT}`));
