// Reading the run records back: the spend so far, and per-condition summaries.
// Every API call this project makes lands in a runs/*.jsonl file, so the sum of
// costUSD across them is the whole bill.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const RUNS_DIR = 'runs';

export function readRuns(dir = RUNS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) =>
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ file: f, ...JSON.parse(line) })),
    );
}

export const spent = (runs = readRuns()) => runs.reduce((s, r) => s + (r.costUSD ?? 0), 0);

// Tool calls that exactly repeat an earlier call in the same run. Under
// compaction this is the agent re-fetching what it was made to forget.
export function requeries(run) {
  const seen = new Set();
  let n = 0;
  for (const t of run.trace) {
    for (const c of t.calls ?? []) {
      const key = c.name + JSON.stringify(sortKeys(c.input));
      if (seen.has(key)) n++;
      seen.add(key);
    }
  }
  return n;
}

function sortKeys(o) {
  if (!o || typeof o !== 'object') return o;
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function summarise(runs) {
  const groups = new Map();
  for (const r of runs) {
    if (!r.condition || r.probe) continue;
    const key = `${r.model}|${r.effort ?? '-'}|${r.condition}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].map(([key, rs]) => {
    const [model, effort, condition] = key.split('|');
    const stops = {};
    for (const r of rs) stops[r.stop] = (stops[r.stop] ?? 0) + 1;
    return {
      model,
      effort,
      condition,
      n: rs.length,
      correct: rs.filter((r) => r.grade.correct).length,
      compareCorrect: rs.filter((r) => r.grade.compareCorrect).length,
      shortcut: rs.filter((r) => r.grade.shortcut).length,
      turns: mean(rs.map((r) => r.turns)),
      toolCalls: mean(rs.map((r) => r.toolCalls)),
      toolErrors: mean(rs.map((r) => r.toolErrors)),
      requeries: mean(rs.map((r) => r.requeries)),
      peakContext: mean(rs.map((r) => r.peakContext)),
      cost: mean(rs.map((r) => r.costUSD)),
      cacheWrite: mean(rs.map((r) => r.usage.cacheWrite)),
      cacheRead: mean(rs.map((r) => r.usage.cacheRead)),
      output: mean(rs.map((r) => r.usage.output)),
      totalCost: rs.reduce((s, r) => s + r.costUSD, 0),
      stops,
    };
  });
}
