'use strict';

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

class Profiler {
  constructor(enabled = false) {
    this.enabled = Boolean(enabled);
    this.startedAt = nowMs();
    this.records = [];
  }

  async measure(stage, fn) {
    if (!this.enabled) return fn();
    const start = nowMs();
    try {
      return await fn();
    } finally {
      this.records.push({ stage, ms: nowMs() - start });
    }
  }

  mark(stage, ms) {
    if (!this.enabled) return;
    this.records.push({ stage, ms });
  }

  summary() {
    const totalMs = nowMs() - this.startedAt;
    const stages = this.records.reduce((acc, r) => {
      acc[r.stage] = (acc[r.stage] || 0) + r.ms;
      return acc;
    }, {});
    return { totalMs, stages };
  }
}

module.exports = {
  Profiler,
  nowMs
};
