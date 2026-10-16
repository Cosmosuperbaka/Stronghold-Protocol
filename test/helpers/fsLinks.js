// Directory links use Windows junctions so filesystem boundary tests do not require elevation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function symlinkSync(target, link, type) {
  const kind = type || (fs.statSync(target).isDirectory() ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file');
  return fs.symlinkSync(target, link, kind);
}
export const canLinkFiles = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-file-link-probe-'));
  try {
    const source = path.join(dir, 'source');
    fs.writeFileSync(source, 'probe');
    fs.symlinkSync(source, path.join(dir, 'link'), 'file');
    return true;
  } catch (e) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) return false;
    throw e;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();
