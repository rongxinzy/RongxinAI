import {
  DefaultAgentAvatar,
  encodeAgentAvatarIcon,
  parseAgentAvatarIcon,
} from '@shared/agent/avatar';
import { Button } from '@shared/components/ui/button';
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
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        onClick={() => setIsOpen((prev) => !prev)}
        title={i18nService.t('agentAvatarPickerTitle')}
        aria-label={i18nService.t('agentAvatarPickerTitle')}
        className={`rounded-full transition-shadow hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/50 ${
          isOpen ? 'ring-2 ring-primary/60' : ''
        }`}
      >
        <AgentAvatarIcon
          value={value}
          className="h-11 w-11"
          iconClassName="h-[22px] w-[22px]"
          legacyClassName="text-2xl"
        />
      </Button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[324px] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        >
          <div className="grid max-h-[360px] grid-cols-6 gap-x-4 gap-y-4 overflow-y-auto px-6 py-5">
            {AGENT_AVATAR_SVG_OPTIONS.map((option) => {
              const optionValue = encodeAgentAvatarIcon({ svg: option.svg });
              const isSelected = draftAvatar.svg === option.svg;

              return (
                <Button
                  key={option.svg}
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setDraftAvatar({ svg: option.svg })}
                  title={i18nService.t(option.labelKey)}
                  aria-label={i18nService.t(option.labelKey)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 ${
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
                </Button>
              );
            })}
          </div>

          <div className="border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="link"
              onClick={handleDone}
              className="h-auto px-0 py-0 text-sm font-medium text-foreground hover:text-primary"
            >
              {i18nService.t('agentAvatarPickerDone')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentAvatarPicker;
