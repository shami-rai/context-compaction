// The experimental conditions, by name. Each returns fresh per-run state:
// { beforeRequest?, betas?, extra?, stats } for runAgent.
//
// Ordered roughly from least to most information destroyed.

import { clientCompaction, serverClearing } from './compaction.mjs';

export const CONDITIONS = {
  control: {
    about: 'No compaction. The full history is sent every turn.',
    make: () => ({ stats: [] }),
  },
  keep3: {
    about: 'Tool results older than the last 3 result turns replaced by a placeholder.',
    make: () => clientCompaction({ keepTurns: 3, replace: 'placeholder' }),
  },
  keep2: {
    about: 'Tool results older than the last 2 result turns replaced by a placeholder.',
    make: () => clientCompaction({ keepTurns: 2, replace: 'placeholder' }),
  },
  keep1: {
    about: 'Only the latest turn of tool results kept; everything older is a placeholder.',
    make: () => clientCompaction({ keepTurns: 1, replace: 'placeholder' }),
  },
  'keep1-pointer': {
    about: 'As keep1, but a cleared result keeps the device ids it listed (no numbers).',
    make: () => clientCompaction({ keepTurns: 1, replace: 'pointer' }),
  },
  'keep1-digest': {
    about: 'As keep1, but a cleared result keeps ids and the four numbers (model-free digest).',
    make: () => clientCompaction({ keepTurns: 1, replace: 'digest' }),
  },
  nothink: {
    about: 'All tool results kept, but thinking from earlier turns removed.',
    make: () => clientCompaction({ keepTurns: Infinity, stripThinking: true }),
  },
  'keep1-nothink': {
    about: 'keep1 plus earlier thinking removed: the model sees its past calls, not what they returned or why it made them.',
    make: () => clientCompaction({ keepTurns: 1, replace: 'placeholder', stripThinking: true }),
  },
  'server-keep3': {
    about: 'API context editing (clear_tool_uses_20250919): above 2,000 input tokens keep only the last 3 tool uses.',
    make: () => serverClearing({ triggerTokens: 2000, keepToolUses: 3 }),
  },
  // Added after the first server-keep3 run cleared results the model had not
  // yet read. The tool caps at 10 rows and batches rarely exceed 10 calls, so
  // keep 10 leaves the latest batch intact and tests whether that was the cause.
  'server-keep10': {
    about: 'API context editing: above 2,000 input tokens keep only the last 10 tool uses.',
    make: () => serverClearing({ triggerTokens: 2000, keepToolUses: 10 }),
  },
};
