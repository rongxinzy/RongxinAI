import { cn } from '@shared/lib/utils';
import { Button } from '@shared/components/ui/button';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, type JSONContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { X } from 'lucide-react';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../../services/i18n';
import { resolveSkillIconUrl } from '../../../services/skillIcon';
import type { RootState } from '../../../store';
import { clearSelection } from '../../../store/slices/quickActionSlice';
import { activateSkill, toggleActiveSkill } from '../../../store/slices/skillSlice';
import type { Skill } from '../../../types/skill';
import { findChatSkillShortcut } from '../../chat/constants';
import { isQuickActionSkill, quickActionSkillIds } from '../../quick-actions/quickActionSelection';
import { PlusMenuSkillsIcon } from '../../cowork/plusMenuIcons';
import type { CoworkAttachment } from '../../cowork/promptInput/types';
import type { MentionCandidate } from './MentionSuggestionList';
import { createSkillMentionExtension, createTextDocFromString } from './SkillMentionExtension';
import { createPromptKeyboardExtension } from './promptKeyboardExtension';

export interface TiptapPromptEditorHandle {
  focus: () => void;
  clear: () => void;
  setDocument: (value: string, doc?: Record<string, unknown> | null) => void;
}

interface TiptapPromptEditorProps {
  value: string;
  draftDoc?: Record<string, unknown> | null;
  externalVersion?: number;
  onChange: (value: string, doc?: Record<string, unknown>) => void;
  placeholder?: string;
  disabled?: boolean;
  attachments?: CoworkAttachment[];
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  className?: string;
}

const resolveInitialContent = (
  value: string,
  draftDoc: Record<string, unknown> | null | undefined,
): JSONContent =>
  draftDoc && typeof draftDoc === 'object' && draftDoc.type === 'doc'
    ? (draftDoc as JSONContent)
    : createTextDocFromString(value);

/**
 * Rich composer input built on `@tiptap/react` + `@tiptap/extension-mention`.
 * Keeps the ProseMirror document as the single live editing truth, persisting
 * `getJSON()` across session transitions and restoring rich mention attributes
 * only on session changes or explicit external replacements.
 */
export const TiptapPromptEditor = forwardRef<TiptapPromptEditorHandle, TiptapPromptEditorProps>(
  (
    {
      value,
      draftDoc = null,
      externalVersion = 0,
      onChange,
      placeholder = '',
      disabled = false,
      attachments = [],
      onKeyDown,
      onPaste,
      className,
    },
    ref,
  ) => {
    const dispatch = useDispatch();
    const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
    const skills = useSelector((state: RootState) => state.skill.skills);
    const quickActions = useSelector((state: RootState) => state.quickAction.actions);
    const selectedActionId = useSelector((state: RootState) => state.quickAction.selectedActionId);

    const lastSeedRef = useRef({ value, draftDoc, externalVersion });
    const lastPropsValueRef = useRef(value);
    const pendingSelfValuesRef = useRef<string[]>([]);
    const mountedRef = useRef(false);
    const clearingRef = useRef(false);
    const placeholderRef = useRef(placeholder);
    placeholderRef.current = placeholder;
    const activeSkillIdsRef = useRef(activeSkillIds);
    activeSkillIdsRef.current = activeSkillIds;
    const skillsRef = useRef(skills);
    skillsRef.current = skills;
    const attachmentsRef = useRef(attachments);
    attachmentsRef.current = attachments;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onKeyDownRef = useRef(onKeyDown);
    onKeyDownRef.current = onKeyDown;
    const onPasteRef = useRef(onPaste);
    onPasteRef.current = onPaste;

    const removeSkill = useCallback(
      (skillId: string) => {
        dispatch(toggleActiveSkill(skillId));
        if (selectedActionId) {
          const action = quickActions.find(item => item.id === selectedActionId);
          if (action && isQuickActionSkill(action, skillId)) {
            const nextIds = activeSkillIdsRef.current.filter(id => id !== skillId);
            if (!quickActionSkillIds(action).every(id => nextIds.includes(id))) {
              dispatch(clearSelection());
            }
          }
        }
      },
      [dispatch, quickActions, selectedActionId],
    );
    const removeSkillRef = useRef(removeSkill);
    removeSkillRef.current = removeSkill;

    const extensions = useMemo(
      () => [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          listItem: false,
          orderedList: false,
          strike: false,
        }),
        Placeholder.configure({
          placeholder: () => placeholderRef.current,
        }),
        createSkillMentionExtension({
          getCandidates: (query: string): MentionCandidate[] => {
            const normalized = query.trim().toLocaleLowerCase();
            const skillCandidates: MentionCandidate[] = skillsRef.current
              .filter(skill => skill.enabled && !activeSkillIdsRef.current.includes(skill.id))
              .map(skill => ({
                id: skill.id,
                label: skill.displayName || skill.name,
                kind: 'skill',
                iconUrl: skill.iconUrl,
              }));
            const fileCandidates: MentionCandidate[] = attachmentsRef.current.map(item => ({
              id: item.path,
              label: item.name,
              kind: 'file',
            }));
            const combined = [...skillCandidates, ...fileCandidates];
            if (!normalized) return combined.slice(0, 10);
            return combined
              .filter(item => item.label.toLocaleLowerCase().includes(normalized))
              .slice(0, 10);
          },
          onSelectCandidate: candidate => {
            if (candidate.kind === 'skill') {
              dispatch(activateSkill(candidate.id));
              return true;
            }
            return false;
          },
        }),
        createPromptKeyboardExtension((view, event) => {
          const isComposing = event.isComposing || event.keyCode === 229;
          if (isComposing) return false;

          if (
            event.key === 'Backspace' &&
            view.state.selection.empty &&
            view.state.selection.from <= 1 &&
            activeSkillIdsRef.current.length > 0
          ) {
            const lastSkillId = activeSkillIdsRef.current[activeSkillIdsRef.current.length - 1];
            if (lastSkillId) {
              event.preventDefault();
              removeSkillRef.current(lastSkillId);
              return true;
            }
          }

          if (onKeyDownRef.current) {
            let prevented = false;
            const synthetic = {
              key: event.key,
              shiftKey: event.shiftKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              altKey: event.altKey,
              nativeEvent: event,
              preventDefault: () => {
                prevented = true;
                event.preventDefault();
              },
              stopPropagation: () => event.stopPropagation(),
            } as unknown as React.KeyboardEvent<HTMLDivElement>;
            onKeyDownRef.current(synthetic);
            if (prevented) return true;
          }

          return false;
        }),
      ],
      [dispatch],
    );

    const editor = useEditor(
      {
        extensions,
        content: resolveInitialContent(value, draftDoc),
        editable: !disabled,
        editorProps: {
          attributes: {
            role: 'textbox',
            'aria-multiline': 'true',
            'aria-label': placeholder,
            class:
              'theme-conversation-editor cowork-prompt-editor w-full outline-none whitespace-pre-wrap wrap-break-word [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_p]:m-0',
          },
          handlePaste: (_view, event) => {
            if (!onPasteRef.current) return false;
            const synthetic = {
              clipboardData: event.clipboardData,
              nativeEvent: event,
              preventDefault: () => event.preventDefault(),
              stopPropagation: () => event.stopPropagation(),
            } as unknown as React.ClipboardEvent<HTMLDivElement>;
            onPasteRef.current(synthetic);
            return event.defaultPrevented;
          },
        },
        onMount: ({ editor: activeEditor }) => {
          mountedRef.current = true;
          const dom = activeEditor.view.dom;
          dom.setAttribute('aria-label', placeholderRef.current);
          const firstChild = dom.firstElementChild;
          if (firstChild && firstChild.classList.contains('is-empty')) {
            firstChild.setAttribute('data-placeholder', placeholderRef.current);
          }
        },
        onDestroy: () => {
          mountedRef.current = false;
        },
        onUpdate: ({ editor: activeEditor }) => {
          if (clearingRef.current) return;
          const nextText = activeEditor.getText({ blockSeparator: '\n' });
          const nextDoc = activeEditor.getJSON() as Record<string, unknown>;
          lastSeedRef.current = {
            value: nextText,
            draftDoc: nextDoc,
            externalVersion: lastSeedRef.current.externalVersion,
          };
          pendingSelfValuesRef.current.push(nextText);
          if (pendingSelfValuesRef.current.length > 16) {
            pendingSelfValuesRef.current.shift();
          }
          onChangeRef.current(nextText, nextDoc);
        },
      },
      [extensions],
    );

    const editorEmpty = useEditorState({
      editor,
      selector: ({ editor: active }) => (!active ? value.trim().length === 0 : active.isEmpty),
    });

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      if (editor.isEditable !== !disabled) {
        editor.setEditable(!disabled, false);
      }
    }, [disabled, editor]);

    useEffect(() => {
      if (!editor || !mountedRef.current || editor.isDestroyed) return;
      const dom = editor.view.dom;
      dom.setAttribute('aria-label', placeholder);
      const firstChild = dom.firstElementChild;
      if (firstChild && firstChild.classList.contains('is-empty')) {
        firstChild.setAttribute('data-placeholder', placeholder);
      }
    }, [editor, placeholder]);

    const applyDocumentToEditor = useCallback(
      (nextText: string, nextDoc: Record<string, unknown> | null | undefined) => {
        lastSeedRef.current = {
          value: nextText,
          draftDoc: nextDoc ?? null,
          externalVersion,
        };
        lastPropsValueRef.current = nextText;
        pendingSelfValuesRef.current = [];
        if (!editor || editor.isDestroyed || !mountedRef.current) return;
        if (!nextText && !nextDoc) {
          clearingRef.current = true;
          try {
            editor.commands.clearContent(false);
          } finally {
            clearingRef.current = false;
          }
          return;
        }
        editor.commands.setContent(resolveInitialContent(nextText, nextDoc), {
          emitUpdate: false,
        });
      },
      [editor, externalVersion],
    );

    // Apply document changes only when driven by explicit external replacements
    // (session switches, draft restoration, quick-action prompts, or direct prop updates).
    useEffect(() => {
      const versionChanged = lastSeedRef.current.externalVersion !== externalVersion;
      const propValueChanged = lastPropsValueRef.current !== value;
      lastPropsValueRef.current = value;

      if (versionChanged) {
        applyDocumentToEditor(value, draftDoc);
        return;
      }

      if (!propValueChanged) return;

      const selfIdx = pendingSelfValuesRef.current.indexOf(value);
      if (selfIdx !== -1) {
        pendingSelfValuesRef.current.splice(0, selfIdx + 1);
        return;
      }

      if (lastSeedRef.current.value !== value) {
        applyDocumentToEditor(value, draftDoc);
      }
    }, [applyDocumentToEditor, draftDoc, externalVersion, value]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (editor && mountedRef.current && !editor.isDestroyed) {
            editor.commands.focus();
          }
        },
        clear: () => {
          lastSeedRef.current = {
            value: '',
            draftDoc: null,
            externalVersion: lastSeedRef.current.externalVersion,
          };
          if (!editor || editor.isDestroyed) return;
          const resetToEmpty = () => {
            if (!editor || editor.isDestroyed || !mountedRef.current) return;
            if (lastSeedRef.current.value !== '') return;
            clearingRef.current = true;
            try {
              if (!editor.isEmpty || editor.getText({ blockSeparator: '\n' }) !== '') {
                editor.commands.clearContent(false);
              }
            } finally {
              clearingRef.current = false;
            }
          };
          resetToEmpty();
          // Guard against delayed ProseMirror/IME DOM observer mutations right after Enter submit.
          queueMicrotask(resetToEmpty);
        },
        setDocument: (nextText, nextDoc) => {
          applyDocumentToEditor(nextText, nextDoc);
        },
      }),
      [applyDocumentToEditor, editor],
    );

    const activeSkills = useMemo(
      () =>
        activeSkillIds
          .map(id => skills.find(skill => skill.id === id))
          .filter((skill): skill is Skill => skill !== undefined),
      [activeSkillIds, skills],
    );

    return (
      <div
        data-editor-empty={editorEmpty ? 'true' : 'false'}
        className={cn(
          'theme-conversation-editor-shell flex w-full min-w-0 flex-col gap-1.5',
          className,
        )}
      >
        {activeSkills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {activeSkills.map(skill => {
              const shortcut = findChatSkillShortcut(skill.id);
              const label = shortcut
                ? i18nService.t(shortcut.labelKey)
                : skill.displayName || skill.name;
              const ShortcutIcon = shortcut?.icon;
              return (
                <span
                  key={skill.id}
                  data-skill-token={skill.id}
                  className="theme-conversation-skill-token inline-flex max-w-44 select-none items-center gap-1"
                >
                  {skill.iconUrl ? (
                    <img
                      src={resolveSkillIconUrl(skill.iconUrl)}
                      alt=""
                      className="theme-conversation-icon shrink-0 object-contain"
                    />
                  ) : ShortcutIcon ? (
                    <ShortcutIcon className="theme-surface-skill-fallback theme-conversation-icon shrink-0" />
                  ) : (
                    <PlusMenuSkillsIcon className="theme-surface-skill-fallback theme-conversation-icon shrink-0" />
                  )}
                  <span className="truncate">{label}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label={`${i18nService.t('clearSkill')} ${label}`}
                    title={i18nService.t('clearSkill')}
                    onClick={() => removeSkill(skill.id)}
                    className="ml-0.5 shrink-0"
                  >
                    <X className="theme-conversation-icon" />
                  </Button>
                </span>
              );
            })}
          </div>
        ) : null}

        <EditorContent editor={editor} className="w-full min-w-0" />
      </div>
    );
  },
);

TiptapPromptEditor.displayName = 'TiptapPromptEditor';
