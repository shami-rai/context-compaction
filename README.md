# Context compaction

What a long-running agent throws away when the window fills, and how it decides. Summarise, score-and-drop, or offload to storage.

Part of the learn → execute → report loop at
[shamirai.ai](https://shamirai.ai/e/context-compaction/). The writeup lives there.

## What this is

An experiment on one question: what can an agent lose from its history and still finish, and where
does compaction stop being housekeeping and start causing the failure? It reuses the task, fleet
and tools from [loop-engineering](https://github.com/shami-rai/loop-engineering): 400 synthetic
connected medical devices, three narrow tools capped at 10 rows, and one question with a known
right answer (AV3-007 vs AV3-024) and a known plausible wrong one (IL7-032). The unmodified task
is solved by Claude Opus 5 even at low effort, so any failure here is caused by what the loop
removes, not by the task being hard.

## Running it

```bash
npm install
# put ANTHROPIC_API_KEY=... in .env (gitignored)
npm run smoke -- --effort low          # one unmodified run
npm run exp -- keep1 --n 5             # five runs of one condition
npm run exp -- control keep1 --n 1     # one run of each named condition
npm run report                         # results table from runs/*.jsonl
```

Runs are strictly sequential. The runner refuses to start a run if the spend already recorded in
`runs/` plus the per-run cap ($0.60) and a $0.15 margin for a capped run's overshoot could cross
the project budget ($8). Every run record, including its full tool trace, grade and what the
compaction hid on each request, is in `runs/`. The answers in those records are the model's own
text, verbatim.

## Design

The task peaks at 5 to 7k tokens, so nothing forces compaction. It is applied on purpose, before
each request, to the copy of the history that is sent. The loop's own history is never edited.
Conditions (all Claude Opus 5, low effort unless stated):

| condition | what is removed before each request |
|---|---|
| control | nothing |
| keep3 / keep2 / keep1 | tool results older than the last 3 / 2 / 1 result turns become `[tool result cleared to save context]` |
| keep1-pointer | as keep1, but a cleared result keeps the device ids it listed |
| keep1-digest | as keep1, but a cleared result keeps ids and the four numbers (a fixed projection, no model involved) |
| nothink | nothing from the results; thinking blocks from every earlier turn are removed |
| keep1-nothink | keep1 plus earlier thinking removed |
| server-keep3 | the API's own `clear_tool_uses_20250919` (beta `context-management-2025-06-27`), trigger 2,000 input tokens, keep 3 tool uses |
| server-keep10 | as server-keep3, keep 10 tool uses |

Measured per run: correct (the device), compare correct (the highest-risk device of the same
model), turns, tool calls, re-queries (tool calls that exactly repeat an earlier call in the same
run), tool errors, results hidden (the most tool results hidden from the model on any single
request, counted by the client transform or from the server's `cleared_tool_uses`, so a strategy
that never fires reads 0), peak context (largest input actually sent, in tokens) and cost. A run
stops without an answer if it reaches 20 turns or its cost passes $0.60 (checked after each
response, so a capped run can end slightly above it). A second table splits each run's tokens
into cache writes, cache reads and output, which is where compaction's cost shows up.
`npm run shapes` describes how each run coped, including the A B A B re-fetch loop some runs
fell into.

Two changes during the experiment, both recorded in the run files: server-keep10 replaced a
planned server-keep1 after the first server-keep3 run showed the server clearing results the
model had not yet read; and the first runs of keep1-nothink and server-keep3 were started as
probes of the API but used the same code and settings as every later run, so they count as run 1
(marked `startedAsProbe`).

## Results

<!-- results:start -->

| model | effort | condition | n | correct | compare correct | turns | tool calls | re-queries | tool errors | results hidden (max) | peak context | cost / run | stops |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-opus-5 | low | control | 3 | 3/3 | 3/3 | 6.0 | 18.0 | 0.0 | 0.0 | 0.0 | 5513 | $0.076 | end_turn 3 |
| claude-opus-5 | low | keep3 | 3 | 3/3 | 3/3 | 5.7 | 16.0 | 0.0 | 0.0 | 7.7 | 4393 | $0.091 | end_turn 3 |
| claude-opus-5 | low | keep2 | 3 | 3/3 | 3/3 | 6.7 | 18.3 | 0.3 | 0.0 | 13.0 | 4249 | $0.121 | end_turn 3 |
| claude-opus-5 | low | keep1 | 3 | 0/3 | 0/3 | 20.0 | 34.3 | 16.0 | 0.0 | 32.3 | 5232 | $0.495 | max_turns 3 |
| claude-opus-5 | low | keep1-pointer | 4 | 3/4 | 3/4 | 10.3 | 27.0 | 4.8 | 0.0 | 25.0 | 4969 | $0.249 | end_turn 3, max_turns 1 |
| claude-opus-5 | low | keep1-digest | 3 | 3/3 | 3/3 | 6.0 | 17.7 | 0.0 | 0.0 | 16.3 | 4477 | $0.115 | end_turn 3 |
| claude-opus-5 | low | nothink | 3 | 3/3 | 3/3 | 6.0 | 16.3 | 0.0 | 0.0 | 0.0 | 4945 | $0.107 | end_turn 3 |
| claude-opus-5 | low | keep1-nothink | 3 | 1/3 | 1/3 | 17.7 | 54.0 | 29.3 | 0.0 | 51.7 | 7537 | $0.567 | end_turn 1, cost_cap 2 |
| claude-opus-5 | low | server-keep3 | 3 | 1/3 | 1/3 | 16.3 | 50.7 | 28.7 | 0.0 | 46.0 | 7596 | $0.528 | cost_cap 2, end_turn 1 |
| claude-opus-5 | low | server-keep10 | 3 | 3/3 | 3/3 | 6.3 | 16.7 | 1.0 | 0.0 | 5.3 | 4526 | $0.105 | end_turn 3 |

Mean tokens per run, by how they were billed:

| model | effort | condition | cache write | cache read | output |
|---|---|---|---|---|---|
| claude-opus-5 | low | control | 3685 | 18165 | 1739 |
| claude-opus-5 | low | keep3 | 7638 | 10727 | 1529 |
| claude-opus-5 | low | keep2 | 11316 | 10123 | 1790 |
| claude-opus-5 | low | keep1 | 66672 | 15719 | 2799 |
| claude-opus-5 | low | keep1-pointer | 29993 | 11432 | 2235 |
| claude-opus-5 | low | keep1-digest | 10686 | 8775 | 1740 |
| claude-opus-5 | low | nothink | 9739 | 10275 | 1620 |
| claude-opus-5 | low | keep1-nothink | 69970 | 15243 | 4866 |
| claude-opus-5 | low | server-keep3 | 66261 | 16116 | 4215 |
| claude-opus-5 | low | server-keep10 | 9149 | 11516 | 1664 |

31 runs in total (0 of them probes or debugging, not in the table). Total API spend: $7.60.

<!-- results:end -->

Limits and cuts. Every condition has 3 runs except keep1-pointer, which has 4: the planned top-ups
to 5 were stopped by the budget guard after the fourth pointer run. At n = 3 a rate of 1/3 and
2/3 cannot be told apart, so the table separates conditions that always finished, never
finished, and sometimes finished, and not much finer than that. Everything is one model (Claude
Opus 5), one effort level (low) and one task. The planned high-effort and Claude Haiku 4.5 arms
were not run.
