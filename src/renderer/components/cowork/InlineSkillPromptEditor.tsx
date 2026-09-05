import { cn } from '@shared/lib/utils';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { resolveSkillIconUrl } from '../../services/skillIcon';
import { RootState } from '../../store';
import { clearSelection } from '../../store/slices/quickActionSlice';
import { clearActiveSkills, toggleActiveSkill } from '../../store/slices/skillSlice';
import { findChatSkillShortcut } from '../chat/constants';

const TOKEN_SELECTOR = '[data-skill-token]';
const REMOVE_SELECTOR = '[data-remove-skill-id]';
const TokenDirection = {
  Previous: 'previous',
  Next: 'next',
} as const;
type TokenDirection = (typeof TokenDirection)[keyof typeof TokenDirection];

const getEditableText = (node: Node): string => {
  if (node instanceof HTMLElement && node.matches(TOKEN_SELECTOR)) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof HTMLBRElement) return '\n';

  const text = Array.from(node.childNodes)
    .map(getEditableText)
    .join('');
  return node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P')
    ? `${text}\n`
    : text;
};

const getAdjacentSkillToken = (
  editor: HTMLDivElement,
  range: Range,
  direction: TokenDirection,
): HTMLElement | null => {
  const isPrevious = direction === TokenDirection.Previous;
  let node: Node | null = null;

  if (range.startContainer === editor) {
    node = isPrevious
      ? editor.childNodes[range.startOffset - 1] ?? null
      : editor.childNodes[range.startOffset] ?? null;
  } else if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer.textContent ?? '';
    if ((isPrevious && range.startOffset > 0) || (!isPrevious && range.startOffset < text.length)) {
      return null;
    }
    node = isPrevious ? range.startContainer.previousSibling : range.startContainer.nextSibling;
  }

  while (node) {
    if (node instanceof HTMLElement && node.matches(TOKEN_SELECTOR)) return node;
    if (node.nodeType !== Node.TEXT_NODE || !/^\s*$/.test(node.textContent ?? '')) return null;
    node = isPrevious ? node.previousSibling : node.nextSibling;
  }
  return null;
};

const createSkillToken = (skillId: string, label: string, iconUrl?: string): HTMLElement => {
  const token = document.createElement('span');
  token.contentEditable = 'false';
  token.dataset.skillToken = skillId;
  token.className =
    'theme-surface-skill-token group mx-0.5 inline-flex h-6 select-none items-center gap-1 px-2';

  const iconSlot = document.createElement('span');
  iconSlot.className = 'relative inline-flex size-3 shrink-0 items-center justify-center';

  if (iconUrl) {
    const icon = document.createElement('img');
    icon.src = iconUrl;
    icon.alt = '';
    icon.className = 'theme-surface-skill-icon size-3 object-contain';
    iconSlot.append(icon);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'theme-surface-skill-icon theme-surface-skill-fallback';
    fallback.textContent = '✦';
    iconSlot.append(fallback);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.tabIndex = -1;
  remove.dataset.removeSkillId = skillId;
  remove.setAttribute('aria-label', `${i18nService.t('clearSkill')} ${label}`);
  remove.title = i18nService.t('clearSkill');
  remove.className =
    'theme-surface-skill-remove pointer-events-none absolute inset-0 inline-flex items-center justify-center group-hover:pointer-events-auto focus-visible:pointer-events-auto';
  remove.textContent = '×';
  iconSlot.append(remove);
  token.append(iconSlot);

  const text = document.createElement('span');
  text.className = 'max-w-40 truncate';
  text.textContent = label;
  token.append(text);
  return token;
};

interface InlineSkillPromptEditorProps {
  value: string;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
}

/**
 * Contenteditable prompt surface that treats selected skills as inline input
 * tokens. Tokens are deliberately managed in the DOM so ordinary typing does
 * not remount the editor or move the caret to the end on every keystroke.
 */
const InlineSkillPromptEditor = forwardRef<HTMLDivElement, InlineSkillPromptEditorProps>(
  ({ value, placeholder, disabled, className, onChange, onKeyDown, onPaste }, forwardedRef) => {
    const dispatch = useDispatch();
    const editorRef = useRef<HTMLDivElement>(null);
    const selectionRef = useRef<Range | null>(null);
    const emittedValueRef = useRef(value);
    const pendingRestoreValueRef = useRef<string | null>(null);
    const contentSnapshotRef = useRef<DocumentFragment | null>(null);
    const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
    const skills = useSelector((state: RootState) => state.skill.skills);
    const selectedActionId = useSelector((state: RootState) => state.quickAction.selectedActionId);
    const selectedQuickAction = useSelector((state: RootState) =>
      state.quickAction.actions.find(action => action.id === selectedActionId),
    );
    const quickActionSkillId = selectedQuickAction?.skillMapping;
    const renderedSkillIds = useMemo(
      () => (activeSkillIds.length > 0 ? activeSkillIds : quickActionSkillId ? [quickActionSkillId] : []),
      [activeSkillIds, quickActionSkillId],
    );

    useImperativeHandle(forwardedRef, () => editorRef.current as HTMLDivElement, []);

    const captureSelection = useCallback(() => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
        selectionRef.current = range.cloneRange();
      }
    }, []);

    const placeCaretAfter = useCallback((node: Node) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStartAfter(node);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      selectionRef.current = range.cloneRange();
    }, []);

    const removeSkill = useCallback(
      (skillId: string) => {
        if (quickActionSkillId === skillId && activeSkillIds.length === 0) {
          dispatch(clearSelection());
          dispatch(clearActiveSkills());
          return;
        }
        dispatch(toggleActiveSkill(skillId));
      },
      [activeSkillIds.length, dispatch, quickActionSkillId],
    );

    useLayoutEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const knownIds = new Set(renderedSkillIds);
      editor.querySelectorAll<HTMLElement>(TOKEN_SELECTOR).forEach(token => {
        if (!knownIds.has(token.dataset.skillToken ?? '')) {
          const spacer = token.nextSibling;
          if (spacer?.nodeType === Node.TEXT_NODE && /^\s*$/.test(spacer.textContent ?? '')) {
            spacer.remove();
          }
          token.remove();
        }
      });

      const currentIds = new Set(
        Array.from(editor.querySelectorAll<HTMLElement>(TOKEN_SELECTOR)).map(
          token => token.dataset.skillToken ?? '',
        ),
      );
      const missingIds = renderedSkillIds.filter(skillId => !currentIds.has(skillId));
      if (missingIds.length === 0) return;

      missingIds.forEach(skillId => {
        const skill = skills.find(item => item.id === skillId);
        const shortcut = findChatSkillShortcut(skillId);
        const label = shortcut
          ? i18nService.t(shortcut.labelKey)
          : skill?.displayName || skill?.name || skillId;
        const token = createSkillToken(skillId, label, resolveSkillIconUrl(skill?.iconUrl));
        const spacer = document.createTextNode(' ');
        const range = selectionRef.current;

        if (range && editor.contains(range.startContainer)) {
          range.insertNode(spacer);
          range.insertNode(token);
          placeCaretAfter(spacer);
        } else {
          editor.append(token, spacer);
        }
      });
    }, [placeCaretAfter, renderedSkillIds, skills]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || value === emittedValueRef.current) return;

      if (pendingRestoreValueRef.current === value && contentSnapshotRef.current) {
        editor.replaceChildren(contentSnapshotRef.current.cloneNode(true));
        emittedValueRef.current = value;
        pendingRestoreValueRef.current = null;
        contentSnapshotRef.current = null;
        requestAnimationFrame(() => {
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          selectionRef.current = range.cloneRange();
        });
        return;
      }

      if (value === '' && emittedValueRef.current) {
        const snapshot = document.createDocumentFragment();
        Array.from(editor.childNodes).forEach(node => snapshot.append(node.cloneNode(true)));
        contentSnapshotRef.current = snapshot;
        pendingRestoreValueRef.current = emittedValueRef.current;
      } else {
        pendingRestoreValueRef.current = null;
        contentSnapshotRef.current = null;
      }

      const textNodes = Array.from(editor.childNodes).filter(node => {
        return !(node instanceof HTMLElement && node.matches(TOKEN_SELECTOR));
      });
      textNodes.forEach(node => node.remove());
      if (value) editor.append(document.createTextNode(value));
      emittedValueRef.current = value;
    }, [value]);

    const handleInput = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      captureSelection();
      const nextValue = Array.from(editor.childNodes).map(getEditableText).join('');
      emittedValueRef.current = nextValue;
      onChange(nextValue);
    }, [captureSelection, onChange]);

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        const remove = target.closest<HTMLElement>(REMOVE_SELECTOR);
        const skillId = remove?.dataset.removeSkillId;
        if (!skillId) return;
        event.preventDefault();
        removeSkill(skillId);
        requestAnimationFrame(() => {
          const editor = editorRef.current;
          if (!editor) return;
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          selectionRef.current = range.cloneRange();
        });
      },
      [removeSkill],
    );

    const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest(REMOVE_SELECTOR)) event.preventDefault();
    }, []);

    const handleEditorPaste = useCallback(
      (event: React.ClipboardEvent<HTMLDivElement>) => {
        onPaste(event);
        if (event.defaultPrevented) return;

        event.preventDefault();
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!editor.contains(range.startContainer)) return;

        const text = event.clipboardData.getData('text/plain');
        const textNode = document.createTextNode(text);
        range.deleteContents();
        range.insertNode(textNode);
        placeCaretAfter(textNode);
        handleInput();
      },
      [handleInput, onPaste, placeCaretAfter],
    );

    const handleEditorKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (
          !event.nativeEvent.isComposing &&
          (event.key === 'Backspace' || event.key === 'Delete')
        ) {
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          if (range?.collapsed) {
            const editor = editorRef.current;
            const token = editor
              ? getAdjacentSkillToken(
                  editor,
                  range,
                  event.key === 'Backspace' ? TokenDirection.Previous : TokenDirection.Next,
                )
              : null;
            const skillId = token?.dataset.skillToken;
            if (skillId) {
              event.preventDefault();
              removeSkill(skillId);
              return;
            }
          }
        }
        onKeyDown(event);
      },
      [onKeyDown, removeSkill],
    );

    return (
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        onBlur={captureSelection}
        onClick={handleClick}
        onFocus={captureSelection}
        onInput={handleInput}
        onKeyDown={handleEditorKeyDown}
        onKeyUp={captureSelection}
        onMouseDown={handleMouseDown}
        onMouseUp={captureSelection}
        onPaste={handleEditorPaste}
        className={cn(
          'theme-surface-skill-editor min-h-20 w-full whitespace-pre-wrap break-words px-3 py-2 empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)] disabled:cursor-not-allowed',
          className,
        )}
      />
    );
  },
);

InlineSkillPromptEditor.displayName = 'InlineSkillPromptEditor';

export default InlineSkillPromptEditor;
