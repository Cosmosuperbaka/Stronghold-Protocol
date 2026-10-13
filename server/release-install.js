// Transactional program-file replacement. Local art/settings/packs not listed by the release are retained.
import fs from 'node:fs';
import path from 'node:path';
import { parseManifest, verifyFiles, digestFile, removalProblem, isSetupArt } from './update.js';

/** Reject symlink/junction destinations instead of following them out of the install. */
function targetPath(root, rel) {
  if (rel !== 'MANIFEST.json' && rel !== 'UPDATE.json' && removalProblem(rel)) throw new Error(`拒绝替换本机路径：${rel}`);
  let current = root;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (stat.isSymbolicLink()) throw new Error(`更新目标包含符号链接：${rel}`);
  }
  return current;
}

/** Backup replaced/deleted files first; restore all touched paths if replacement or verification fails. */
export function applyReleaseStage(root, stage, { copyFile = fs.copyFileSync } = {}) {
  root = fs.realpathSync(root);
  const next = parseManifest(fs.readFileSync(path.join(stage, 'MANIFEST.json'), 'utf8'));
  for (const rel of next.files.keys()) if (isSetupArt(rel) || removalProblem(rel)) throw new Error(`程序清单包含保留路径：${rel}`);
  const checked = verifyFiles(stage, next.files);
  if (checked.missing.length || checked.mismatched.length) throw new Error('暂存程序文件校验失败');
  let previous = null;
  try { previous = parseManifest(fs.readFileSync(path.join(root, 'MANIFEST.json'), 'utf8')); } catch { /* source installs have none */ }
  const newNames = new Set([...next.files.keys()].map((rel) => rel.toLowerCase()));
  const removed = [];
  for (const [rel, hash] of previous?.files || []) {
    if (newNames.has(rel.toLowerCase()) || isSetupArt(rel) || removalProblem(rel)) continue;
    const file = targetPath(root, rel);
    if (digestFile(file)?.sha256 === hash.sha256) removed.push(rel);
  }
  const files = [...next.files.keys(), 'MANIFEST.json'];
  const changed = [...files, ...removed];
  if (fs.existsSync(path.join(root, 'UPDATE.json'))) changed.push('UPDATE.json');
  // Validate every destination before modifying anything.
  for (const rel of changed) {
    const file = targetPath(root, rel);
    if (fs.existsSync(file) && !fs.statSync(file).isFile()) throw new Error(`更新目标不是普通文件：${rel}`);
  }
  const backups = path.join(root, 'logs', 'update-backups');
  fs.mkdirSync(backups, { recursive: true });
  const backup = fs.mkdtempSync(path.join(backups, 'release-'));
  const existing = new Set();
  for (const rel of changed) {
    const file = targetPath(root, rel);
    if (!fs.existsSync(file)) continue;
    const dst = path.join(backup, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(file, dst);
    existing.add(rel);
  }
  fs.writeFileSync(path.join(backup, 'restore.json'), JSON.stringify({ files: changed, existing: [...existing] }, null, 2));
  const touched = [];
  try {
    for (const rel of files) {
      const file = targetPath(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      touched.push(rel);
      copyFile(path.join(stage, rel), file);
    }
    for (const rel of [...removed, ...(changed.includes('UPDATE.json') ? ['UPDATE.json'] : [])]) {
      touched.push(rel);
      fs.unlinkSync(targetPath(root, rel));
    }
    const result = verifyFiles(root, next.files);
    if (result.missing.length || result.mismatched.length) throw new Error('替换后程序文件校验失败');
    return { app: next.app, backup, removed: removed.length };
  } catch (e) {
    const failures = [];
    for (const rel of touched.reverse()) {
      try {
        const dst = targetPath(root, rel);
        if (existing.has(rel)) fs.copyFileSync(path.join(backup, rel), dst);
        else fs.rmSync(dst, { force: true });
      } catch (err) { failures.push(`${rel}: ${err.message}`); }
    }
    if (failures.length) {
      const error = new Error(`更新失败且部分文件恢复失败；备份在 ${backup}：${failures.join('；')}`, { cause: e });
      error.restartSafe = false;
      throw error;
    }
    throw new Error(`更新失败，已恢复原程序：${e.message}`, { cause: e });
  }
}
