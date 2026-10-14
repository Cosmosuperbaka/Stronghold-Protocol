// Detached restart helper: acknowledge readiness before the old process stops, then wait for its exit.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function prepareRestart(root, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), root, String(process.pid)], {
      cwd: root, env: { ...process.env, ...env }, detached: true, windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const fail = (e) => { clearTimeout(timer); child.kill(); reject(e); };
    const timer = setTimeout(() => fail(new Error('重启助手未就绪，请重试')), 10000);
    child.once('error', fail);
    child.once('exit', () => fail(new Error('重启助手提前退出')));
    child.on('message', (message) => {
      if (message !== 'ready') return;
      clearTimeout(timer);
      child.removeAllListeners('exit');
      child.disconnect();
      child.unref();
      resolve(() => child.kill());
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, pidText] = process.argv.slice(2);
  const pid = Number(pidText);
  if (!root || !Number.isSafeInteger(pid) || pid < 1) process.exit(1);
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  const fd = fs.openSync(path.join(root, 'logs', 'service-restart.log'), 'a');
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  process.send?.('ready');
  for (let i = 0; i < 160 && alive(); i++) await new Promise((r) => setTimeout(r, 250));
  if (alive()) { fs.writeSync(fd, '原服务器未退出，取消重启\n'); process.exit(1); }
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
  });
  child.on('error', (e) => fs.appendFileSync(path.join(root, 'logs', 'service-restart.log'), `${e.message}\n`));
  child.unref();
  fs.closeSync(fd);
}
