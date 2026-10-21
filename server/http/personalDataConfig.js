// Optional deployment default. The machine's address stays in ignored local/, never in source.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export function readPersonalDataConfig(file = path.join(ROOT, 'local', 'personal-data.json')) {
  try {
    if (fs.statSync(file).size > 4096) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw?.migrationSource !== 'string' || !raw.migrationSource.trim()) return {};
    const url = new URL(raw.migrationSource);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return {};
    return { migrationSource: url.href };
  } catch { return {}; }
}
