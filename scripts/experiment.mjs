// Run one or more conditions, n times each, strictly one run at a time.
//   npm run exp -- <condition> [<condition> ...] [--n 5] [--effort low]
//                  [--model claude-opus-5] [--max-turns 20] [--probe] [--verbose]
//
// Every run is appended to runs/<model>-<effort>-<condition>.jsonl with its
// grade, its re-query count and what the compaction hid on each request.
// --probe sends records to runs/probes.jsonl instead: still counted in the
// spend, never in the results table.

import { appendFile, mkdir } from 'node:fs/promises';
import { runAgent, localExecutor } from '../src/rig/agent.mjs';
import { toolDefs, runTool } from '../src/rig/tools.mjs';
import { SYSTEM, QUESTION } from '../src/rig/task.mjs';
import { grade } from '../src/rig/grade.mjs';
import { CONDITIONS } from '../src/conditions.mjs';
import { spent, requeries, RUNS_DIR } from '../src/ledger.mjs';

// The whole project may not spend more than this, debugging included.
export const BUDGET_USD = 8;
// No single run may spend more than this. A run is refused if the spend so far
// plus this cap could cross the budget, so the budget cannot be overrun.
const PER_RUN_CAP_USD = 0.6;

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i > -1 ? argv[i + 1] : d;
};
const VALUED = new Set(['--n', '--effort', '--model', '--max-turns']);
const names = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));

const model = opt('model', 'claude-opus-5');
const effort = opt('effort', 'low');
const n = Number(opt('n', 5));
const maxTurns = Number(opt('max-turns', 20));
const probe = flag('probe');
const verbose = flag('verbose') || probe;

for (const name of names) if (!CONDITIONS[name]) throw new Error(`unknown condition "${name}"`);
if (!names.length) throw new Error(`name a condition: ${Object.keys(CONDITIONS).join(', ')}`);

await mkdir(RUNS_DIR, { recursive: true });
const short = model.replace(/^claude-/, '').replace(/-/g, '');
const effortTag = model.startsWith('claude-haiku') ? 'na' : effort;

for (const name of names) {
  const file = probe ? `${RUNS_DIR}/probes.jsonl` : `${RUNS_DIR}/${short}-${effortTag}-${name}.jsonl`;
  for (let i = 1; i <= n; i++) {
    const before = spent();
    if (before + PER_RUN_CAP_USD > BUDGET_USD) {
      console.log(`budget: $${before.toFixed(3)} spent, next run could cross $${BUDGET_USD}. Stopping.`);
      process.exit(0);
    }

    const state = CONDITIONS[name].make();
    const run = await runAgent({
      model,
      effort,
      system: SYSTEM,
      question: QUESTION,
      tools: toolDefs,
      execute: localExecutor(runTool),
      beforeRequest: state.beforeRequest,
      betas: state.betas,
      extra: state.extra ?? {},
      maxTurns,
      maxCostUSD: PER_RUN_CAP_USD,
      label: name,
    });

    const g = grade(run);
    const record = {
      condition: name,
      ...(probe ? { probe: true } : {}),
      at: new Date().toISOString(),
      ...run,
      requeries: requeries(run),
      compaction: state.stats,
      grade: g,
    };
    await appendFile(file, JSON.stringify(record) + '\n');

    if (verbose) {
      for (const t of run.trace) {
        const c = state.stats.find((s) => s.turn === t.turn);
        const cm = t.contextManagement?.applied_edits?.map((e) => `${e.cleared_tool_uses} uses/${e.cleared_input_tokens} tok`);
        console.log(
          `  turn ${t.turn} ctx ${t.context} out ${t.output} ${t.stop_reason ?? 'ERROR ' + t.error}` +
            (c ? ` | cleared ${c.cleared} thinking-stripped ${c.strippedThinking} answer-visible ${c.answerIdVisible}` : '') +
            (cm?.length ? ` | server cleared ${cm.join(', ')}` : ''),
        );
        for (const call of t.calls ?? []) console.log(`    ${call.name} ${JSON.stringify(call.input)}${call.isError ? '  ERROR' : ''}`);
      }
      if (run.answer) console.log('  ' + run.answer.split('\n').slice(-3).join('\n  '));
    }
    console.log(
      `${name} ${effortTag} #${i}: ${g.correct ? 'CORRECT' : 'wrong'} ${g.answerId ?? '-'} vs ${g.compareId ?? '-'}` +
        ` | stop ${run.stop} | turns ${run.turns} | calls ${run.toolCalls} (requery ${record.requeries}, err ${run.toolErrors})` +
        ` | peak ${run.peakContext} | $${run.costUSD.toFixed(4)} | total $${(before + run.costUSD).toFixed(3)}`,
    );
  }
}
