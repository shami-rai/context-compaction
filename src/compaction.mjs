// Compaction strategies.
//
// Two kinds live here:
//
//   clientCompaction  a beforeRequest transform. The loop keeps its own full,
//                     unedited history; this builds the copy that is actually
//                     sent, with old tool results replaced and, optionally,
//                     the model's earlier thinking removed.
//   serverClearing    the API's own context editing (clear_tool_uses_20250919),
//                     expressed as the betas and extra params the loop passes.
//
// The client strategy has three separate dials, so each can be moved alone:
//   keepTurns      how many of the most recent result messages stay intact.
//                  1 means the model only ever sees what it just asked for.
//   replace        what a cleared result becomes:
//                    placeholder  a fixed line, nothing of the content survives
//                    pointer      the device ids it listed, no numbers
//                    digest       ids and the four numbers, the rest dropped
//   stripThinking  remove thinking blocks from every assistant turn except the
//                  latest, so the model's earlier reasoning is gone too.
//
// Every cleared line starts the same way, so the three replacements differ
// only in how much information they carry, not in how they are worded.

import { ANSWER } from './rig/task.mjs';

const CLEARED = '[tool result cleared to save context]';

// The replacements. Each takes the tool call that produced a result and the
// result text, and returns what the model is shown instead.
const REPLACERS = {
  placeholder: () => CLEARED,

  pointer: (call, content) => {
    const r = parse(content);
    if (!r) return CLEARED;
    if (call.name === 'top_devices') return `${CLEARED} It listed: ${r.devices.map((d) => d.device_id).join(', ')}.`;
    if (call.name === 'get_device') return `${CLEARED} It was the record for ${r.device_id}.`;
    return CLEARED;
  },

  // Model-free: no LLM writes this, it is a fixed projection of the JSON.
  // It keeps what the task needs as numbers and drops model name, site and
  // firmware. Model name is the one dropped field the task could need later.
  digest: (call, content) => {
    const r = parse(content);
    if (!r) return CLEARED;
    if (call.name === 'count_devices') return `${CLEARED} Digest: count ${r.count}.`;
    if (call.name === 'top_devices') {
      const rows = r.devices.map((d) => `${d.device_id} ${d[call.input.field]}`).join(', ');
      return `${CLEARED} Digest: ${r.total_matching} matching; ${rows}.`;
    }
    if (call.name === 'get_device') {
      return (
        `${CLEARED} Digest: ${r.device_id} operating_hours ${r.operating_hours}, alerts ${r.alerts}, ` +
        `risk_score ${r.risk_score}, downtime_min ${r.downtime_min}.`
      );
    }
    return CLEARED;
  },
};

function parse(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

const isResultMessage = (m) =>
  m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result');

// Builds a beforeRequest transform. `stats` collects one row per request so a
// run record can say what was hidden from the model and when.
export function clientCompaction({ keepTurns = Infinity, replace = 'placeholder', stripThinking = false }) {
  const replacer = REPLACERS[replace];
  if (!replacer) throw new Error(`unknown replacement "${replace}"`);
  const stats = [];

  const beforeRequest = (messages, { turn }) => {
    // Which tool_use produced each result, so a replacement can see the call.
    const calls = new Map();
    for (const m of messages) {
      if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
      for (const b of m.content) if (b.type === 'tool_use') calls.set(b.id, b);
    }

    const resultIdx = messages.map((m, i) => (isResultMessage(m) ? i : -1)).filter((i) => i >= 0);
    const clearBefore = keepTurns === Infinity ? -1 : (resultIdx.at(-keepTurns) ?? -1);
    const lastAssistant = messages.findLastIndex((m) => m.role === 'assistant');

    let cleared = 0;
    let strippedThinking = 0;
    const sent = messages.map((m, i) => {
      if (isResultMessage(m) && i < clearBefore) {
        return {
          ...m,
          content: m.content.map((b) => {
            if (b.type !== 'tool_result' || b.is_error) return b;
            cleared++;
            return { ...b, content: replacer(calls.get(b.tool_use_id), b.content) };
          }),
        };
      }
      if (stripThinking && m.role === 'assistant' && i < lastAssistant && Array.isArray(m.content)) {
        const kept = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
        strippedThinking += m.content.length - kept.length;
        return { ...m, content: kept };
      }
      return m;
    });

    // Could the model see the answer device anywhere in what it was sent?
    const answerIdVisible = sent.some(
      (m) =>
        isResultMessage(m) &&
        m.content.some((b) => b.type === 'tool_result' && String(b.content).includes(ANSWER.device_id)),
    );
    stats.push({ turn, cleared, strippedThinking, answerIdVisible });
    return sent;
  };

  return { beforeRequest, stats };
}

// The API's own tool-result clearing. The server does the same kind of edit on
// its copy of the history; the client keeps sending the full transcript.
export function serverClearing({ triggerTokens, keepToolUses }) {
  return {
    betas: ['context-management-2025-06-27'],
    extra: {
      context_management: {
        edits: [
          {
            type: 'clear_tool_uses_20250919',
            trigger: { type: 'input_tokens', value: triggerTokens },
            keep: { type: 'tool_uses', value: keepToolUses },
          },
        ],
      },
    },
    stats: [],
  };
}
