#!/usr/bin/env node
// scripts/start-tunnel.mjs — start the server + a cloudflared quick tunnel, print every address to share, then keep
// streaming timestamped logs (server output, cloudflared warnings/errors, player/room counts when they change).
//
//   node scripts/start-tunnel.mjs [--port 3000] [--no-tunnel]
//
// Ctrl+C stops both. The trycloudflare.com address changes on every start.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { c, mark, padDisplay } from '../tools/setup.mjs';
import { probePort, classifyAddresses, KIND_LABEL } from '../tools/doctor.mjs';
import { freePort } from './free-port.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = Number(portArg >= 0 ? argv[portArg + 1] : process.env.PORT) || 3000;
const TUNNEL = !argv.includes('--no-tunnel');

const ts = () => new Date().toTimeString().slice(0, 8);
const log = (tag, line) => console.log(`${c.dim(ts())} ${tag} ${line}`);

/** cloudflared from PATH, or the winget / MSI install location. */
function cloudflaredPath() {
  const known = ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'];
  return known.find((p) => fs.existsSync(p)) || 'cloudflared';
}

/** Pipe a child's stdout + stderr through `onLine`. */
function lines(child, onLine) {
  for (const s of [child.stdout, child.stderr]) readline.createInterface({ input: s }).on('line', onLine);
}

function printShare(tunnelUrl) {
  const bar = c.dim('═'.repeat(60));
  console.log(`\n${bar}`);
  console.log(`${mark.ok} ${c.bold('可以访问的地址')}`);
  console.log(`  ${padDisplay('本机', 8)}  ${c.cyan(`http://localhost:${PORT}`)}`);
  for (const a of classifyAddresses().filter((x) => ['lan', 'vpn', 'public'].includes(x.kind))) {
    console.log(`  ${padDisplay(KIND_LABEL[a.kind], 8)}  ${c.cyan(`http://${a.address}:${PORT}`)}`);
  }
  if (tunnelUrl) console.log(`  ${padDisplay('公网隧道', 8)}  ${c.bold(c.cyan(tunnelUrl))}  ${c.dim('← 发给朋友（每次启动都会变）')}`);
  else if (TUNNEL) console.log(c.warn('  公网隧道  未就绪（见上方 cloudflared 日志）'));
  console.log(c.dim('  按 Ctrl+C 停止服务器和隧道。以下为实时日志：'));
  console.log(`${bar}\n`);
}

async function waitHealthy(child, timeoutMs = 30000) {
  for (const until = Date.now() + timeoutMs; Date.now() < until && child.exitCode === null;) {
    if ((await probePort(PORT)).state === 'ours') return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Always start clean: stop an old server / tunnel left on this port.
if (!(await freePort(PORT))) {
  console.error(`${mark.err} 端口 ${PORT} 释放失败。换端口：--port 3001`);
  process.exit(1);
}

const children = [];
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(server);
lines(server, (l) => l.trim() && log(c.ok('[server]'), l));
server.on('exit', (code) => { log(c.err('[server]'), `已退出 (code ${code})`); shutdown(code ?? 1); });

if (!(await waitHealthy(server))) {
  console.error(`${mark.err} 服务器 30 秒内没有启动成功，见上方日志。`);
  server.kill();
  process.exit(1);
}

let tunnelUrl = null;
if (TUNNEL) {
  const cf = spawn(cloudflaredPath(), ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(cf);
  cf.on('error', (e) => { log(c.err('[tunnel]'), `cloudflared 启动失败：${e.message}（winget install Cloudflare.cloudflared）`); printShare(null); });
  cf.on('exit', (code) => log(c.err('[tunnel]'), `cloudflared 已退出 (code ${code})，公网地址失效`));
  const waitUrl = setTimeout(() => { if (!tunnelUrl) printShare(null); }, 30000);
  lines(cf, (l) => {
    const m = !tunnelUrl && l.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) { tunnelUrl = m[0]; clearTimeout(waitUrl); printShare(tunnelUrl); return; }
    // cloudflared is chatty at INF; only surface problems and (re)connections
    if (/\b(ERR|WRN)\b|Registered tunnel connection/.test(l)) log(c.warn('[tunnel]'), l.replace(/^\S+Z\s+/, ''));
  });
} else {
  printShare(null);
}

// Player / room counts from /healthz, logged only when they change.
let lastStats = '';
setInterval(async () => {
  const p = await probePort(PORT);
  if (p.state !== 'ours') return;
  const h = p.health;
  const s = `在线连接 ${h.sockets} · 玩家 ${h.humans} · 房间 ${h.rooms} · 对局 ${h.matches}`;
  if (s !== lastStats) { lastStats = s; log(c.cyan('[status]'), s); }
}, 5000).unref();

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const ch of children) if (ch.exitCode === null) { try { ch.kill(); } catch { /* gone */ } }
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on('SIGINT', () => { log(c.dim('[launch]'), '正在停止…'); shutdown(0); });
process.on('SIGTERM', () => shutdown(0));
