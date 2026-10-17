#!/usr/bin/env python3
"""Apply one-line streaming regressions and run the guard test subset."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
TESTS = [
    'tests/streamingGlmReplay.test.ts',
    'tests/streamingAuditPipeline.test.ts',
    'tests/streamingAuditPrune.test.ts',
    'tests/streamingRetryStoreGuards.test.ts',
    'src/main/libs/agentEngine/piStreamAccumulator.test.ts',
    'src/main/libs/agentEngine/piEventProjectionQueue.test.ts',
    'src/main/libs/agentEngine/piRuntimeAdapter.assistantStreaming.test.ts',
    'src/main/libs/agentEngine/piRuntimeAdapter.autoRetry.test.ts',
    'src/main/libs/agentEngine/piAssistantTranscript.test.ts',
    'tests/streamingGuards.test.ts',
    'tests/streamingConsistency.test.ts',
]

TE = 'src/main/libs/agentEngine/piRuntimeTurnEvents.ts'
TR = 'src/main/libs/agentEngine/piAssistantTranscript.ts'

M: dict[str, list[tuple[str, str, str]]] = {
    'M1 accumulator: *_start/_end read snapshot again': [
        (
            'src/main/libs/agentEngine/piStreamAccumulator.ts',
            "    if (event.type.startsWith('toolcall_')) return true;\n    return (\n      event.type === PiAssistantEventType.TextStart ||",
            "    return (\n      false ||",
        ),
        (
            'src/main/libs/agentEngine/piStreamSnapshotPolicy.ts',
            "  if (assistantEventType.startsWith('toolcall_')) return true;\n  return (\n    assistantEventType === PiAssistantEventType.TextStart ||",
            "  return (\n    false ||",
        ),
    ],
    'M2b error path never finalizes (A9b/A9c)': [
        (
            TE,
            '            this.host.transcript.closeIdlePlaceholders(sessionId, active, {\n              finalize: true,\n            });',
            '            this.host.transcript.closeIdlePlaceholders(sessionId, active, {\n              finalize: false,\n            });',
        ),
    ],
    'M3 no reopenStreamingMessagesForRetry': [
        (TE, 'this.host.transcript.reopenStreamingMessagesForRetry(sessionId, active);', ''),
    ],
    'M4 retry does not reuse ids': [(TE, '        if (active.retryStreamReusePending) {', '        if (false) {')],
    'M5 closeIdle metadata not merged': [(TR, '        ...existing?.metadata,\n', '')],
    'M6 closeIdle does not skip finalized ids': [
        (TR, 'if (finalize && this.finalizedMessageIds.has(entry.messageId)) continue;', ''),
        (
            TR,
            'if (active.thinkingMessageId && !active.thinkingLifecycle.isMessageFinalized) {',
            'if (active.thinkingMessageId) {',
        ),
    ],
    'M7 multi-answer context flush removed': [
        (
            TR,
            '    if (!messageId) return;\n    this.flushContextUsageSync(sessionId);\n',
            '    if (!messageId) return;\n',
        ),
    ],
    'M8 image blocks not skipped': [
        ('src/main/workbenchTask/textWorkerOperations.ts', "if (block.type === 'image') return '';", ''),
    ],
    'M9 renderer streamReopen branch removed': [
        ('src/renderer/services/coworkStreamPipeline.ts', '} else if (event.metadata?.streamReopen === true) {', '} else if (false) {'),
    ],
    'M10 forwarder streamReopen branch removed': [
        ('src/main/appBootstrap/piUiForwarder.ts', 'if (metadata?.streamReopen === true) {', 'if (false) {'),
    ],
    'M11 tool text raw displayResultText': [
        (
            'src/main/libs/agentEngine/piEventProjectionQueue.ts',
            'event.displayResultText ?? syncPiToolResultDisplayText(event.result);',
            'event.displayResultText;',
        ),
    ],
    'M12 arm flag on any error (old A9 bug)': [
        (
            TE,
            '            active.turnFailed = true;\n            active.retryStreamReusePending = false;\n',
            '            active.turnFailed = true;\n            active.retryStreamReusePending = Boolean(active.assistantMessageId || active.thinkingMessageId);\n',
        ),
    ],
    'M13 agent_end does not arm on willRetry': [
        (
            TE,
            '            active.retryStreamReusePending = true;\n          } else {',
            '            active.retryStreamReusePending = false;\n          } else {',
        ),
    ],
    'M14 agent_end does not clear without retry': [
        (TE, '          } else {\n            active.retryStreamReusePending = false;\n          }', '          } else {\n          }'),
    ],
    'M15 continueSession does not clear flag': [
        ('src/main/libs/agentEngine/piRuntimeSessionContinuation.ts', '  active.retryStreamReusePending = false;\n', ''),
    ],
    'M16 flushPendingError does not clear flag': [
        (
            'src/main/libs/agentEngine/piRuntimeTurnRecovery.ts',
            '    active.pendingError = null;\n    active.retryStreamReusePending = false;\n',
            '    active.pendingError = null;\n',
        ),
    ],
    'M17 flushPendingError no finalize when no answer text': [
        (
            'src/main/libs/agentEngine/piRuntimeTurnRecovery.ts',
            '    } else {\n      this.host.transcript.closeIdlePlaceholders(sessionId, active, { finalize: true });\n    }',
            '    }',
        ),
    ],
    'M18 stop path does not clear flag/usage': [
        (
            'src/main/libs/agentEngine/piRuntimeSessionLifecycle.ts',
            '  active.retryStreamReusePending = false;\n  host.transcript.clearPendingContextUsage(sessionId);\n',
            '',
        ),
    ],
    'M19 finalizedMessageIds not pruned': [
        (TR, '    this.pruneFinalizedForSession(sessionId);\n', ''),
    ],
    'M20 reopen blanks DB content (old)': [
        (
            TR,
            '.updateMessage(sessionId, messageId, { metadata }, { touchUpdatedAt: false });',
            ".updateMessage(sessionId, messageId, { content: '', metadata }, { touchUpdatedAt: false });",
        ),
    ],
    'M21 forwarder strips streamReopen again': [
        (
            'src/main/appBootstrap/piUiForwarder.ts',
            '          content,\n          metadata,\n        });\n        return;',
            '          content,\n          metadata: { ...metadata, streamReopen: undefined },\n        });\n        return;',
        ),
    ],
    'M22 BoundedIdSet.delete no-op': [
        (
            'src/renderer/services/coworkStreamPipeline.ts',
            '    delete: id => {\n      ids.delete(id);\n    },',
            '    delete: _id => {},',
        ),
    ],
    'M23 retry turn_start clears visible text before reopen': [
        (
            TE,
            '          const priorAnswer = active.answerText;\n          const priorThinking = active.thinkingText;\n          this.host.transcript.reopenStreamingMessagesForRetry(sessionId, active);\n          active.answerText = \'\';\n',
            '          const priorAnswer = active.answerText;\n          const priorThinking = active.thinkingText;\n          active.answerText = \'\';\n          active.thinkingText = \'\';\n          this.host.transcript.reopenStreamingMessagesForRetry(sessionId, active);\n',
        ),
    ],
}


def sub(path: str, old: str, new: str, count: int = 1) -> None:
    full = os.path.join(ROOT, path)
    text = open(full, encoding='utf-8').read()
    if old not in text:
        raise AssertionError(f'missing patch anchor in {path}: {old[:80]!r}')
    open(full, 'w', encoding='utf-8').write(text.replace(old, new, count))


def main() -> int:
    only = sys.argv[1:]
    results: dict[str, object] = {}
    for name, patches in M.items():
        if only and not any(name.startswith(o) for o in only):
            continue
        try:
            for path, old, new in patches:
                sub(path, old, new)
            proc = subprocess.run(
                ['bunx', 'vitest', 'run', *TESTS],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=600,
            )
            out = proc.stdout + proc.stderr
            fails = sorted(set(re.findall(r'FAIL\s+(\S+)\s+>\s*(.*)', out)))
            summ = re.findall(r'Tests\s+(.*)', out)
            results[name] = {
                'exit': proc.returncode,
                'summary': summ[-1] if summ else out[-400:],
                'failing': [f'{a} > {b[:90]}' for a, b in fails][:8],
            }
        except AssertionError as error:
            results[name] = {'error': str(error)}
        finally:
            restore_paths = sorted({path for path, _, _ in patches})
            subprocess.run(['git', 'checkout', '--', *restore_paths], cwd=ROOT, check=False)
        print(name, json.dumps(results[name])[:700], flush=True)

    out_path = os.path.join(ROOT, 'scripts/ci/streaming-mutations-results.json')
    with open(out_path, 'w', encoding='utf-8') as handle:
        json.dump(results, handle, indent=1)
    print(f'Wrote {out_path}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
