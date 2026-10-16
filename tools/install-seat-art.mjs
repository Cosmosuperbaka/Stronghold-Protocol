// Resume room-poster downloads from the generated catalogue; never alters game data.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSeatPortraits } from './build-seat-art.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(join(root, name), 'utf8').then(JSON.parse);
const catalogue = await read('data/seat-art.json');
const inventory = await read('docs/research/seat-art-portraits.json');
const files = new Map(inventory.map(name => [name.replaceAll('#', '_').replaceAll('+', '_plus'), name]));
const jobs = new Map();
for (const c of Object.values(catalogue.chars || {})) for (const s of c.choices || []) {
  const file = s.portrait?.match(/^\/assets\/seat-portrait\/([A-Za-z0-9_.-]+\.png)$/)?.[1];
  const original = files.get(file);
  if (!original) throw Error('Unknown poster source: ' + s.portrait);
  jobs.set(file, 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/portrait/' + encodeURIComponent(original));
}
await installSeatPortraits(root, jobs);
