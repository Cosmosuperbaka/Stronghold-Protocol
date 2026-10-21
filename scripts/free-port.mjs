#!/usr/bin/env node
// scripts/free-port.mjs — stop whatever listens on the game port, plus cloudflared tunnels pointing at it (Windows).
//
//   node scripts/free-port.mjs [--port 3000]
//
// Run by scripts/stop-server.bat, and by scripts/start-tunnel.mjs before it starts.
// ponytail: Windows only (PowerShell + taskkill); add lsof / pkill when someone hosts on macOS / Linux.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { c, mark } from '../tools/setup.mjs';
import { probePort } from '../tools/doctor.mjs';

/** Listeners on `port` and cloudflared processes started with `--url …localhost:<port>`. */
function findProcesses(port) {
  const ps = `$ErrorActionPreference = 'SilentlyContinue'
$l = @(Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object OwningProcess | Sort-Object -Unique)
$t = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -match 'localhost:${port}(\\D|$)' } | ForEach-Object ProcessId)
$out = @($l | ForEach-Object { [pscustomobject]@{ pid = $_; name = (Get-Process -Id $_).ProcessName; tunnel = $false } }) +
       @($t | ForEach-Object { [pscustomobject]@{ pid = $_; name = 'cloudflared'; tunnel = $true } })
ConvertTo-Json -InputObject $out -Compress`;
  // -EncodedCommand (UTF-16LE base64) sidesteps every quoting rule between Node, cmd and PowerShell
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout.trim() || '[]').filter((p) => p.pid > 4); } catch { return []; }
}

/** Kill everything holding `port` (and its tunnels), then wait until the port is free. @returns {Promise<boolean>} free */
export async function freePort(port) {
  if (process.platform !== 'win32') return (await probePort(port)).state === 'free';
  // tunnels first: killing an old launcher's server makes that launcher stop its own cloudflared under our feet
  const found = findProcesses(port).sort((a, b) => b.tunnel - a.tunnel);
  for (const p of found) {
    const r = spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
    console.log(`${r.status === 0 ? mark.ok : mark.err} 结束 ${p.name} (PID ${p.pid}，${p.tunnel ? '公网隧道' : '占用端口'})${r.status === 0 ? '' : '：' + (r.stderr || r.stdout).trim()}`);
  }
  for (const until = Date.now() + 5000; Date.now() < until;) {
    if ((await probePort(port)).state === 'free') {
      if (found.length) console.log(`${mark.ok} 端口 ${port} 已释放`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  const i = process.argv.indexOf('--port');
  const port = Number(i >= 0 ? process.argv[i + 1] : process.env.PORT) || 3000;
  const free = await freePort(port);
  if (!free) console.log(`${mark.err} 端口 ${port} 仍被占用（可能需要以管理员身份运行）`);
  else console.log(c.dim(`端口 ${port} 现在空闲。`));
  process.exitCode = free ? 0 : 1;
}
