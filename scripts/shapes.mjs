// How each run coped, read from its trace. Not graded, descriptive.
//   npm run shapes [-- <condition>]
//
// Columns:
//   answer fetches  how many times get_device was called on the answer device
//   risk fetches    how many times the answer model's risk ranking was fetched
//   together        whether the final tool turn fetched the answer record AND the
//                   comparison's risk score at once, either by re-running the
//                   risk ranking or by fetching the comparison device's own
//                   record by id. That is the shape that survives keep-1.
//   ping-pong       the longest tail of turns alternating between exactly two
//                   single-call turns, A B A B ..., the livelock seen in keep1

import { readRuns } from '../src/ledger.mjs';
import { ANSWER } from '../src/rig/task.mjs';

const only = process.argv[2];
const key = (c) => c.name + JSON.stringify(c.input);
const isAnswerRecord = (c) => c.name === 'get_device' && c.input?.device_id === ANSWER.device_id;
const isRiskRanking = (c) => c.name === 'top_devices' && c.input?.field === 'risk_score' && c.input?.model === ANSWER.model;
const isCompareRecord = (c) =>
  c.name === 'get_device' && c.input?.device_id === ANSWER.highest_risk_same_model.device_id;

function pingPong(trace) {
  const turns = trace.filter((t) => t.calls?.length).map((t) => (t.calls.length === 1 ? key(t.calls[0]) : null));
  let best = 0;
  for (let end = turns.length; end >= 2; end--) {
    let len = 0;
    for (let i = end - 1; i >= 0; i--) {
      const a = turns[i];
      if (a === null) break;
      if (len >= 2 && a !== turns[i + 2]) break;
      if (len === 1 && a === turns[i + 1]) break;
      len++;
    }
    best = Math.max(best, len);
  }
  return best >= 4 ? best : 0;
}

const rows = readRuns()
  .filter((r) => r.condition && !r.probe && (!only || r.condition === only))
  .sort((a, b) => a.file.localeCompare(b.file) || a.at.localeCompare(b.at));

console.log('condition            effort ok  stop       turns calls answer-fetch risk-fetch together ping-pong');
for (const r of rows) {
  const calls = r.trace.flatMap((t) => t.calls ?? []);
  const lastToolTurn = r.trace.filter((t) => t.calls?.length).at(-1);
  const together = Boolean(
    lastToolTurn?.calls.some(isAnswerRecord) &&
      lastToolTurn?.calls.some((c) => isRiskRanking(c) || isCompareRecord(c)),
  );
  console.log(
    [
      r.condition.padEnd(20),
      String(r.effort ?? 'na').padEnd(6),
      (r.grade.correct ? 'yes' : 'NO').padEnd(3),
      r.stop.padEnd(10),
      String(r.turns).padStart(5),
      String(r.toolCalls).padStart(5),
      String(calls.filter(isAnswerRecord).length).padStart(12),
      String(calls.filter(isRiskRanking).length).padStart(10),
      (together ? 'yes' : '-').padStart(8),
      String(pingPong(r.trace) || '-').padStart(9),
    ].join(' '),
  );
}
