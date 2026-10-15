// i18n-ignore-file: local host update scheduler. Downloads and verification remain in release-update.js.
import fs from 'node:fs';
import path from 'node:path';

export function createIdleUpdater({ updater, file, hasActive, announce, now = Date.now }) {
  let enabled = false, lastCheck = null, target = null, deadline = null, failedTag = null, checking = false;
  let state = 'disabled', error = null;
  let generation = 0;
  try { enabled = JSON.parse(fs.readFileSync(file, 'utf8')).enabled === true; } catch { /* opt-in */ }
  const status = () => ({ enabled, lastCheck, target, deadline, state, error });
  function matchStarted() { if (deadline != null) { deadline = null; state = 'waiting'; } }
  async function tick() {
    if (!enabled || checking) return;
    if (lastCheck == null || now() - lastCheck >= 3600000) {
      checking = true; lastCheck = now();
      const attempt = generation;
      try {
        const s = await updater.check();
        if (!enabled || attempt !== generation) return;
        if (s.error) { target = null; deadline = null; state = 'error'; error = s.error; return; }
        const next = s.versions?.find((v) => v.relation === 'new');
        target = next?.tag || null;
        if (target && (!next.signed || !next.installable)) { state = 'error'; error = next.reason || '自动安装仅接受已签名的正式新版'; failedTag = target; return; }
        error = null;
      } catch (e) { if (enabled && attempt === generation) { target = null; deadline = null; state = 'error'; error = e.message; } return; }
      finally { checking = false; }
    }
    if (!target) { if (state !== 'error') state = 'up-to-date'; return; }
    if (failedTag === target) return;
    const s = updater.status();
    if (!s.canInstall) { state = 'error'; error = '当前启动方式不支持自动重启'; return; }
    if (['downloading', 'verifying', 'scheduled'].includes(s.state)) { state = 'installing'; return; }
    if (state === 'installing' && s.error) { state = 'error'; error = s.error; failedTag = target; return; }
    if (hasActive()) { deadline = null; state = 'waiting'; return; }
    if (deadline == null) {
      deadline = now() + 60000; state = 'announcing';
      announce('服务器将在 1 分钟后更新并重启'); return;
    }
    if (now() < deadline) return;
    deadline = null;
    const result = updater.install({ tag: target });
    if (result.error) { error = result.error; state = 'error'; failedTag = target; }
    else state = result.state === 'active-matches' ? 'waiting' : 'installing';
  }
  return { status, tick, matchStarted,
    configure(value) {
      if (typeof value !== 'boolean') return { error: '自动更新设置必须为开或关' };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ enabled: value })); fs.renameSync(`${file}.tmp`, file);
      generation++; enabled = value; deadline = null; target = null; lastCheck = null; failedTag = null; state = value ? 'idle' : 'disabled'; error = null;
      return { ok: true, ...status() };
    },
  };
}
