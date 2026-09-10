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
`runs/` plus the per-run cap ($0.60) could cross the project budget ($8). Every run record,
including its full tool trace, grade and what the compaction hid on each request, is in `runs/`.

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
<!-- results:end -->
