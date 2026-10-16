// Generate machine-local preload metadata after setup or installing additional outfits/art.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResourceManifest } from '../server/http/resourceManifest.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = await buildResourceManifest({ publicDir: path.join(root, 'public') });
await mkdir(path.join(root, 'data'), { recursive: true });
await writeFile(path.join(root, 'data/resource-manifest.json'), JSON.stringify(manifest));
console.log(`resource-manifest: ${manifest.count} files, ${manifest.totalBytes} bytes, ${manifest.version}`);
