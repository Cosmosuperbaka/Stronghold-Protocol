// i18n-ignore-file: opt-in local host diagnostics, no persistence or additional protocol frames.
export function createResources({ lobby, network, traffic, now = Date.now, processInfo = process }) {
  const history = [], rooms = new Map(), latency = new WeakMap();
  let total = { in: 0, out: 0, assets: 0 }, previous = { ...total }, last = now(), cpu = processInfo.cpuUsage();
  const monitor = {
    ping(ws) { latency.set(ws, { ...latency.get(ws), sent: now() }); },
    pong(ws) { const p = latency.get(ws); if (p?.sent != null) latency.set(ws, { rtt: Math.max(0, now() - p.sent), at: now() }); },
  };
  if (network) network.monitor = monitor;
  traffic?.observe((e) => {
    if (e.kind === 'http') { if (e.category === 'assets' || e.category === 'audio') total.assets += e.bytes; return; }
    total[e.direction] += e.bytes;
    const code = network?.conns.get(e.socket)?.session?.roomCode;
    if (!code) return;
    const r = rooms.get(code) || { in: 0, out: 0, prevIn: 0, prevOut: 0 };
    r[e.direction] += e.bytes; rooms.set(code, r);
  });
  function sample() {
    const at = now(), seconds = Math.max(0.001, (at - last) / 1000), nextCpu = processInfo.cpuUsage();
    const byRoom = [];
    for (const [code, r] of rooms) {
      if (!lobby.rooms.has(code)) { rooms.delete(code); continue; }
      byRoom.push({ code, rx: (r.in - r.prevIn) / seconds, tx: (r.out - r.prevOut) / seconds });
      r.prevIn = r.in; r.prevOut = r.out;
    }
    const all = [...lobby.rooms.values()], sessions = [...(lobby.registry?.all() || [])];
    const memory = processInfo.memoryUsage();
    const row = { at, uptime: processInfo.uptime(), rss: memory.rss, heap: memory.heapUsed,
      cpu: Math.max(0, (nextCpu.user + nextCpu.system - cpu.user - cpu.system) / (seconds * 10000)),
      sessions: sessions.filter((s) => s.connected).length, rooms: all.length, matches: all.filter((r) => r.match && !r.match.ended).length,
      spectators: all.reduce((n, r) => n + (r.spectators || []).length, 0),
      rx: (total.in - previous.in) / seconds, tx: (total.out - previous.out) / seconds, assets: (total.assets - previous.assets) / seconds, byRoom };
    last = at; cpu = nextCpu; previous = { ...total }; history.push(row);
    while (history.length > 600 || history[0]?.at < at - 600000) history.shift();
    return row;
  }
  const timer = setInterval(sample, 1000); timer.unref();
  return { sample, monitor, snapshot() {
    return { current: history.at(-1) || sample(), history,
      players: [...(lobby.registry?.all() || [])].filter((s) => s.connected).map((s) => ({ playerId: s.playerId, name: s.name, room: s.roomCode, ...latency.get(s.ws) })) };
  }, close() { clearInterval(timer); traffic?.observe(null); if (network?.monitor === monitor) delete network.monitor; } };
}
