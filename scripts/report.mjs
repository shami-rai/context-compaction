// The results table, from every run record under runs/.
//   npm run report             print it
//   npm run report -- --write  also replace the table in README.md
//
// Probe runs count toward the spend line but not the table.

import { readFileSync, writeFileSync } from 'node:fs';
import { readRuns, summarise, spent } from '../src/ledger.mjs';
import { CONDITIONS } from '../src/conditions.mjs';

const runs = readRuns();
const order = Object.keys(CONDITIONS);
const rows = summarise(runs).sort(
  (a, b) =>
    a.model.localeCompare(b.model) ||
    a.effort.localeCompare(b.effort) ||
    order.indexOf(a.condition) - order.indexOf(b.condition),
);

const f0 = (x) => x.toFixed(0);
const f1 = (x) => x.toFixed(1);
const lines = [
  '| model | effort | condition | n | correct | compare correct | turns | tool calls | re-queries | tool errors | peak context | cost / run | stops |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.model} | ${r.effort} | ${r.condition} | ${r.n} | ${r.correct}/${r.n} | ${r.compareCorrect}/${r.n} | ` +
      `${f1(r.turns)} | ${f1(r.toolCalls)} | ${f1(r.requeries)} | ${f1(r.toolErrors)} | ${f0(r.peakContext)} | ` +
      `$${r.cost.toFixed(3)} | ${Object.entries(r.stops).map(([k, v]) => `${k} ${v}`).join(', ')} |`,
  ),
];
// Where the money went. Every compaction edit moves the prompt-cache prefix,
// so the same history is written to cache (1.25x input price) instead of read
// from it (0.1x). This table is what shows that.
lines.push(
  '',
  'Mean tokens per run, by how they were billed:',
  '',
  '| model | effort | condition | cache write | cache read | output |',
  '|---|---|---|---|---|---|',
  ...rows.map(
    (r) => `| ${r.model} | ${r.effort} | ${r.condition} | ${f0(r.cacheWrite)} | ${f0(r.cacheRead)} | ${f0(r.output)} |`,
  ),
);

const probes = runs.filter((r) => r.probe || !r.condition);
const footer =
  `${runs.length} runs in total (${probes.length} of them probes or debugging, not in the table). ` +
  `Total API spend: $${spent(runs).toFixed(2)}.`;
const table = lines.join('\n') + '\n\n' + footer;

console.log(table);

if (process.argv.includes('--write')) {
  const readme = readFileSync('README.md', 'utf8');
  const start = '<!-- results:start -->';
  const end = '<!-- results:end -->';
  const i = readme.indexOf(start);
  const j = readme.indexOf(end);
  if (i < 0 || j < 0) throw new Error('README.md has no results markers');
  writeFileSync('README.md', readme.slice(0, i + start.length) + '\n\n' + table + '\n\n' + readme.slice(j));
  console.log('\nREADME.md updated.');
}
