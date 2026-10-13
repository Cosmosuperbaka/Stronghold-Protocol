#!/usr/bin/env node
// The old server starts this detached helper and exits only after receiving its ready acknowledgement.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { applyReleaseStage } from '../server/release-install.js';
import { updatePaths, saveUpdateStatus, installedIdentity } from '../server/release-update.js';

const [root, stage, pidText, tag] = process.argv.slice(2);
const pid = Number(pidText);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
const paths = updatePaths(root);
const base = path.resolve(root, 'logs', 'update-staging');
const relative = path.relative(base, path.resolve(stage));
if (!Number.isSafeInteger(pid) || pid < 1 || !relative || relative.startsWith('..') || path.isAbsolute(relative)) process.exit(1);
process.send?.('ready');
for (let i = 0; i < 160 && alive(); i++) await sleep(250);
if (alive()) {
  saveUpdateStatus(root, { state: 'error', error: '原服务器未退出，更新已取消' });
  fs.rmSync(paths.lock, { force: true });
  process.exit(1);
}
let applied = false;
let restartSafe = true;
try {
  const result = applyReleaseStage(root, stage);
  fs.writeFileSync(paths.version, JSON.stringify({ app: result.app, tag, sourceHash: installedIdentity(root) }));
  saveUpdateStatus(root, { state: 'installed', tag, backup: result.backup });
  applied = true;
} catch (e) { restartSafe = e.restartSafe !== false; saveUpdateStatus(root, { state: 'error', error: e.message }); }
finally { if (restartSafe) fs.rmSync(paths.lock, { force: true }); }
if (applied) fs.rmSync(path.dirname(stage), { recursive: true, force: true });
// Scheduled task/NSSM/systemd owns the restart when SP_UPDATE_RESTART=supervisor.
if (restartSafe && process.env.SP_UPDATE_RESTART !== 'supervisor') {
  const fd = fs.openSync(path.join(root, 'logs', 'release-restart.log'), 'a');
  const child = spawn(process.execPath, [...process.execArgv, path.join(root, 'server', 'index.js')], {
    cwd: root, detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
  });
  child.on('error', (e) => saveUpdateStatus(root, { state: 'error', error: `重启失败：${e.message}` }));
  child.unref();
  fs.closeSync(fd);
}
