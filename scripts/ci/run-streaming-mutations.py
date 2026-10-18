#!/usr/bin/env python3
"""Apply one-line streaming regressions and run the guard test subset."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile

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
    'src/main/libs/agentEngine/piRuntimeAdapter.sessionControl.test.ts',
    'src/main/libs/agentEngine/piAssistantTranscript.test.ts',
    'src/renderer/services/coworkStreamPipeline.streamReopen.test.ts',
    'tests/streamingGuards.test.ts',
    'tests/streamingConsistency.test.ts',
]

TE = 'src/main/libs/agentEngine/piRuntimeTurnEvents.ts'
TR = 'src/main/libs/agentEngine/piAssistantTranscript.ts'
LC = 'src/main/libs/agentEngine/piRuntimeSessionLifecycle.ts'
REC = 'src/main/libs/agentEngine/piRuntimeTurnRecovery.ts'

# Defensive duplicate guards — surviving mutations here do not fail CI.
ALLOWLIST_SURVIVORS: tuple[str, ...] = (
    'M13 ',
    'M14 ',
    'M15 ',
    'M16 ',
    'M18 stop path does not clear retry flag',
)

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
            REC,
            '    active.pendingError = null;\n    active.retryStreamReusePending = false;\n',
            '    active.pendingError = null;\n',
        ),
    ],
    'M17 flushPendingError no finalize when no answer text': [
        (
            REC,
            '    } else {\n      this.host.transcript.closeIdlePlaceholders(sessionId, active, { finalize: true });\n    }',
            '    }',
        ),
    ],
    'M18 stop path does not clear retry flag (defensive duplicate)': [
        (LC, '  active.retryStreamReusePending = false;\n', ''),
    ],
    'M18 stop path does not clear pending context usage': [
        (LC, '  host.transcript.clearPendingContextUsage(sessionId);\n', ''),
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
            '          active.retryPriorAnswer = priorAnswer;\n          this.host.transcript.reopenStreamingMessagesForRetry(sessionId, active);\n          active.answerText = \'\';\n',
            '          active.retryPriorAnswer = priorAnswer;\n          active.answerText = \'\';\n          active.thinkingText = \'\';\n          this.host.transcript.reopenStreamingMessagesForRetry(sessionId, active);\n',
        ),
    ],
    'M24a empty placeholder guard: persisted content length': [
        (TR, '    if (existing.content.length > 0) return;\n', ''),
    ],
    'M24b empty placeholder guard: streamed content length': [
        (TR, '    if (streamed.length > 0) return;\n', ''),
    ],
    'M24c empty placeholder guard: in-memory answer text': [
        (
            TR,
            '    const inMemory = active.answerText || active.retryPriorAnswer;\n    if (inMemory.length > 0) return;\n',
            '',
        ),
    ],
    'M32 finalizeMessage empty path skips resolved prior answer': [
        (
            TR,
            '        const resolved = this.resolveStreamedContent(emptyId, active, \'answer\');\n        if (resolved.trim()) {\n          return this.finalizeMessage(sessionId, active, kind, resolved);\n        }\n',
            '',
        ),
    ],
    'M37 finalizeMessage clears throttle maps before placeholder removal': [
        (
            TR,
            '        this.removeEmptyAnswerPlaceholder(sessionId, emptyId, active);\n        this.clearThrottleMapsForMessage(emptyId);\n',
            '        this.clearThrottleMapsForMessage(emptyId);\n        this.removeEmptyAnswerPlaceholder(sessionId, emptyId, active);\n',
        ),
    ],
}


def sub(path: str, old: str, new: str, count: int = 1) -> None:
    full = os.path.join(ROOT, path)
    text = open(full, encoding='utf-8').read()
    if old not in text:
        raise AssertionError(f'missing patch anchor in {path}: {old[:80]!r}')
    open(full, 'w', encoding='utf-8').write(text.replace(old, new, count))


def is_allowlisted(name: str) -> bool:
    return any(name.startswith(prefix) for prefix in ALLOWLIST_SURVIVORS)


def ensure_node_sqlite() -> None:
    subprocess.run(
        ['npm', 'rebuild', 'better-sqlite3', '--build-from-source'],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def run_vitest() -> subprocess.CompletedProcess[str]:
    env = {**os.environ, 'CI': 'true'}
    return subprocess.run(
        [
            'npm',
            'exec',
            '--',
            'vitest',
            'run',
            '--pool=forks',
            '--maxWorkers=1',
            *TESTS,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=900,
        env=env,
    )


def main() -> int:
    args = [arg for arg in sys.argv[1:] if arg != '--ci-gate']
    ci_gate = '--ci-gate' in sys.argv
    only = args
    results: dict[str, object] = {}

    ensure_node_sqlite()
    baseline = run_vitest()
    baseline_out = baseline.stdout + baseline.stderr
    if baseline.returncode != 0:
        print('Baseline vitest subset failed before mutations:', flush=True)
        print(baseline_out[-2000:], flush=True)
        return 1
    print('Baseline vitest subset passed', flush=True)

    for name, patches in M.items():
        if only and not any(name.startswith(o) for o in only):
            continue
        try:
            for path, old, new in patches:
                sub(path, old, new)
            proc = run_vitest()
            out = proc.stdout + proc.stderr
            fails = sorted(set(re.findall(r'FAIL\s+(\S+)\s+>\s*(.*)', out)))
            summ = re.findall(r'Tests\s+(.*)', out)
            results[name] = {
                'exit': proc.returncode,
                'caught': proc.returncode != 0,
                'allowlisted': is_allowlisted(name),
                'summary': summ[-1] if summ else out[-400:],
                'failing': [f'{a} > {b[:90]}' for a, b in fails][:8],
            }
        except AssertionError as error:
            results[name] = {'error': str(error), 'caught': False, 'allowlisted': is_allowlisted(name)}
        finally:
            restore_paths = sorted({path for path, _, _ in patches})
            subprocess.run(['git', 'checkout', '--', *restore_paths], cwd=ROOT, check=False)
        print(name, json.dumps(results[name])[:700], flush=True)

    out_path = os.path.join(tempfile.gettempdir(), 'streaming-mutations-results.json')
    with open(out_path, 'w', encoding='utf-8') as handle:
        json.dump(results, handle, indent=1)
    print(f'Wrote {out_path}', flush=True)

    patch_errors = [name for name, row in results.items() if 'error' in row]
    survived = [
        name
        for name, row in results.items()
        if row.get('exit') == 0 and not row.get('allowlisted') and 'error' not in row
    ]
    allowlisted_survivors = [
        name for name, row in results.items() if row.get('exit') == 0 and row.get('allowlisted')
    ]
    print(
        f'Summary: caught={sum(1 for r in results.values() if r.get("caught"))} '
        f'survived_must_catch={len(survived)} allowlisted_survivors={len(allowlisted_survivors)} '
        f'patch_errors={len(patch_errors)}',
        flush=True,
    )
    if survived:
        print('Survived (must-catch):', ', '.join(survived), flush=True)
    if allowlisted_survivors:
        print('Survived (allowlisted):', ', '.join(allowlisted_survivors), flush=True)
    if patch_errors:
        print('Patch errors:', ', '.join(patch_errors), flush=True)

    if ci_gate and (survived or patch_errors):
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
