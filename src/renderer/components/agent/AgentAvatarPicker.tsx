import {
  DefaultAgentAvatar,
  encodeAgentAvatarIcon,
  parseAgentAvatarIcon,
} from '@shared/agent/avatar';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import AgentAvatarIcon, {
  AGENT_AVATAR_SVG_OPTIONS,
} from './AgentAvatarIcon';

interface AgentAvatarPickerProps {
  value: string;
  onChange: (value: string) => void;
}

const AgentAvatarPicker: React.FC<AgentAvatarPickerProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedAvatar = useMemo(() => {
    return parseAgentAvatarIcon(value) ?? DefaultAgentAvatar;
  }, [value]);

  // Local draft state: tracks preview selection inside the popup only
  const [draftAvatar, setDraftAvatar] = useState(selectedAvatar);

  // Reset draft to the committed value whenever the popup opens
  useEffect(() => {
    if (isOpen) {
      setDraftAvatar(selectedAvatar);
    }
  }, [isOpen, selectedAvatar]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  const handleDone = () => {
    onChange(encodeAgentAvatarIcon(draftAvatar));
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        title={i18nService.t('agentAvatarPickerTitle')}
        aria-label={i18nService.t('agentAvatarPickerTitle')}
        className={`rounded-full transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 ${
          isOpen ? 'ring-2 ring-primary/60' : ''
        }`}
      >
        <AgentAvatarIcon
          value={value}
          className="h-11 w-11"
          iconClassName="h-[22px] w-[22px]"
          legacyClassName="text-2xl"
        />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[324px] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        >
          <div className="grid max-h-[360px] grid-cols-6 gap-x-4 gap-y-4 overflow-y-auto px-6 py-5">
            {AGENT_AVATAR_SVG_OPTIONS.map((option) => {
              const optionValue = encodeAgentAvatarIcon({ svg: option.svg });
              const isSelected = draftAvatar.svg === option.svg;

              return (
                <button
                  key={option.svg}
                  type="button"
                  onClick={() => setDraftAvatar({ svg: option.svg })}
                  title={i18nService.t(option.labelKey)}
                  aria-label={i18nService.t(option.labelKey)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                    isSelected
                      ? 'bg-surface-raised text-foreground shadow-sm ring-1 ring-border'
                      : 'text-foreground hover:bg-secondary/10'
                  }`}
                >
                  <AgentAvatarIcon
                    value={optionValue}
                    className="h-10 w-10"
                    iconClassName="h-6 w-6"
                    useDefaultWhenEmpty={false}
                  />
                </button>
              );
            })}
          </div>

          <div className="border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={handleDone}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              {i18nService.t('agentAvatarPickerDone')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentAvatarPicker;
