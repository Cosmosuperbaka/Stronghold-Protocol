// Per-connection state baselines. A failed socket write never advances the baseline.
import { diffState, isStateKind } from '../shared/stateDelta.js';
export class StateSender {
  constructor() { this.states = new Map(); }
  reset() { this.states.clear(); }
  send(message, write) {
    const full = JSON.parse(JSON.stringify(message)), kind = full.t;
    if (!isStateKind(kind)) return write(JSON.stringify(full));
    const previous = this.states.get(kind), seq = (previous?.seq || 0) + 1;
    const complete = JSON.stringify({ t: 'm.state', kind, seq, full });
    let encoded = complete;
    if (previous) {
      const patch = diffState(previous.view, full);
      if (patch) {
        const delta = JSON.stringify({ t: 'm.state', kind, seq, base: previous.seq, patch });
        if (delta.length < complete.length) encoded = delta;
      }
    }
    if (!write(encoded)) return false;
    this.states.set(kind, { seq, view: full }); return true;
  }
}
