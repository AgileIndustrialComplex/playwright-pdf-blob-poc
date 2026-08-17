'use strict';

const fs = require('fs');

// Reads this process's resident set size in MB from /proc/self/status.
// Works in Linux containers (the runtime target). No deps.
function rssMB() {
  try {
    const st = fs.readFileSync('/proc/self/status', 'utf8');
    const m = st.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    if (m) return Math.round((parseInt(m[1], 10) * 1024) / (1024 * 1024) * 100) / 100;
  } catch (_) {}
  try {
    const st = fs.readFileSync('/proc/self/statm', 'utf8');
    const pageKb = 4 * 1024;
    const pages = parseInt(st.split(' ')[1], 10);
    if (pages) return Math.round((pages * pageKb) / (1024 * 1024) * 100) / 100;
  } catch (_) {}
  return null;
}

// Samples RSS on a fixed cadence so we can reconstruct a memory timeline:
// cold-start memory (at readiness), peak during render, steady-state after.
class MemorySampler {
  constructor(intervalMs = 100) {
    this.intervalMs = intervalMs;
    this.samples = []; // {t: ms since start, mb: MB, mark?: string}
    this._timer = null;
    this._startedAt = null;
  }

  start() {
    this._startedAt = Date.now();
    this.samples.push({ t: 0, mb: rssMB(), mark: 'process-start' });
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  mark(label) {
    if (!this._startedAt) this.start();
    this.samples.push({ t: Date.now() - this._startedAt, mb: rssMB(), mark: label });
  }

  _tick() {
    this.samples.push({ t: Date.now() - this._startedAt, mb: rssMB() });
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  rssNow() {
    return rssMB();
  }

  min() {
    return this.samples.reduce((a, s) => (s.mb !== null && s.mb < a ? s.mb : a), Infinity);
  }

  peak(msFrom = 0) {
    let peak = 0;
    for (const s of this.samples) {
      if (s.t < msFrom) continue;
      if (s.mb !== null && s.mb > peak) peak = s.mb;
    }
    return peak;
  }

  atMark(label) {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].mark === label) return this.samples[i].mb;
    }
    return null;
  }

  // Compact CSV lines for the benchmark sweep file.
  toCSV() {
    return this.samples.map((s) => `${Math.round(s.t)},${s.mb !== null ? s.mb : ''},${s.mark || ''}`).join('\n');
  }
}

module.exports = { MemorySampler, rssMB };