// Fetch Shakespeare TEI XML from the DraCor mirror of the Folger corpus.
// Idempotent: skips files that already exist on disk.
//
// Source:  https://github.com/dracor-org/shakedracor (CC BY-NC 3.0)
// Output:  ./data/<slug>.xml (host) → /app/data/<slug>.xml (container)

import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const BASE = 'https://raw.githubusercontent.com/dracor-org/shakedracor/main/tei';
const OUT = process.env.DATA_DIR || './data';

const PLAYS = [
  'hamlet',
  'othello',
  'macbeth',
  'king-lear',
  'romeo-and-juliet',
];

await mkdir(OUT, { recursive: true });

for (const slug of PLAYS) {
  const file = path.join(OUT, `${slug}.xml`);

  try {
    await access(file, constants.F_OK);
    console.log(`${slug}: already on disk, skipping`);
    continue;
  } catch {}

  const url = `${BASE}/${slug}.xml`;
  process.stdout.write(`${slug}: fetching… `);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAIL (${res.status} ${res.statusText})`);
    continue;
  }
  const xml = await res.text();
  await writeFile(file, xml);
  console.log(`saved (${xml.length.toLocaleString()} bytes)`);
}

console.log('Done.');
