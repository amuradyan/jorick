// Ingest Folger Shakespeare TEI-Simple XML into pgvector.
//
// Expects DATABASE_URL in the environment.
// Usage: node ingest.js data/*.xml
// Folger TEI-Simple XML: https://folgerdigitaltexts.org (Download > TEI Simple)

import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import xpathPkg from 'xpath';
import { pipeline, env } from '@huggingface/transformers';
import pg from 'pg';
import pgvector from 'pgvector';

env.cacheDir = '/app/.cache';

const TEI_NS = 'http://www.tei-c.org/ns/1.0';
const select = xpathPkg.useNamespaces({ tei: TEI_NS });

const EMBED_MODEL = 'Xenova/bge-large-en-v1.5';
const BATCH = 64;

function speechText(sp) {
  return select('.//tei:l | .//tei:p', sp)
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

async function parsePlay(xmlPath) {
  const xml = await readFile(xmlPath, 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const titleEl = select('.//tei:titleStmt/tei:title', doc, true);
  const title = ((titleEl && titleEl.textContent) || xmlPath)
    .replace(/\s+/g, ' ')
    .trim();

  const out = [];
  for (const act of select(".//tei:div[@type='act']", doc)) {
    const actN = parseInt(act.getAttribute('n') || '0', 10);
    for (const scene of select(".//tei:div[@type='scene']", act)) {
      const sceneN = parseInt(scene.getAttribute('n') || '0', 10);
      for (const sp of select('.//tei:sp', scene)) {
        const speakerEl = select('tei:speaker', sp, true);
        const speaker = speakerEl
          ? speakerEl.textContent.trim() || null
          : null;
        const text = speechText(sp);
        if (text) {
          out.push({ play: title, act: actN, scene: sceneN, speaker, text });
        }
      }
    }
  }
  return out;
}

function* batched(arr, n) {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}

// Prepend speaker so retrieval can latch onto "what did Jorick say about…"
function embedInput(p) {
  return p.speaker ? `${p.speaker}: ${p.text}` : p.text;
}

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('usage: node ingest.js <xml-files...>');
    process.exit(1);
  }

  const dsn = process.env.DATABASE_URL;
  if (!dsn) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  console.log(`Loading embedding model: ${EMBED_MODEL}`);
  const extractor = await pipeline('feature-extraction', EMBED_MODEL);

  const client = new pg.Client({ connectionString: dsn });
  await client.connect();

  try {
    for (const xmlPath of paths) {
      const passages = await parsePlay(xmlPath);
      if (passages.length === 0) {
        console.log(`${xmlPath}: no passages parsed, skipping`);
        continue;
      }

      const play = passages[0].play;
      await client.query('BEGIN');
      await client.query('DELETE FROM passages WHERE play = $1', [play]);

      for (const batch of batched(passages, BATCH)) {
        const inputs = batch.map(embedInput);
        const output = await extractor(inputs, {
          pooling: 'mean',
          normalize: true,
        });
        const vectors = output.tolist();

        for (let i = 0; i < batch.length; i++) {
          const p = batch[i];
          await client.query(
            `INSERT INTO passages (play, act, scene, speaker, text, embedding)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              p.play,
              p.act,
              p.scene,
              p.speaker,
              p.text,
              pgvector.toSql(vectors[i]),
            ],
          );
        }
      }

      await client.query('COMMIT');
      console.log(`${xmlPath}: ${play} — ${passages.length} passages`);
    }
  } finally {
    await client.end();
  }
}

await main();
