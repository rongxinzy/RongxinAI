import { Button } from '@shared/components/ui/button';
import { ArrowRight } from 'lucide-react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { RootState } from '../../store';
import { selectPrompt } from '../../store/slices/quickActionSlice';
import type { LocalizedPrompt, LocalizedQuickAction } from '../../types/quickAction';

interface PromptPanelProps {
  action: LocalizedQuickAction;
  onPromptSelect: (prompt: string) => void;
}

const PromptPanel: React.FC<PromptPanelProps> = ({ action, onPromptSelect }) => {
  const dispatch = useDispatch();
  const selectedPromptId = useSelector((state: RootState) => state.quickAction.selectedPromptId);

  const handlePromptClick = (prompt: LocalizedPrompt) => {
    dispatch(selectPrompt(prompt.id));
    onPromptSelect(prompt.prompt);
  };

  if (!action.prompts || action.prompts.length === 0) {
    return null;
  }

  return (
    <div className="w-full animate-fade-in-up">
      {/* 标题 */}
      <div className="mb-2.5 px-0.5">
        <span className="text-xs font-medium text-muted-foreground">{action.label}</span>
      </div>

      {/* 提示词卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {action.prompts.map(prompt => {
          const isPromptSelected = selectedPromptId === prompt.id;

          return (
            <Button
              key={prompt.id}
              type="button"
              variant="outline"
              onClick={() => handlePromptClick(prompt)}
              className={` theme-page-prompt-panel-button-variant-3 group relative flex flex-col items-start text-left ${
                isPromptSelected
                  ? 'theme-page-prompt-panel-button-variant-1'
                  : 'theme-page-prompt-panel-button-variant-2'
              }
              `}
            >
              {/* 标题 */}
              <div className="flex items-center justify-between w-full">
                <span
                  className={`text-sm font-medium ${isPromptSelected ? 'text-primary' : 'text-foreground'}`}
                >
                  {prompt.label}
                </span>
                <ArrowRight
                  className={`
                    w-3.5 h-3.5 transition-[transform,opacity,color] duration-200
                    ${
                      isPromptSelected
                        ? 'text-primary translate-x-0 opacity-100'
                        : 'text-muted-foreground -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                    }
                  `}
                />
              </div>

              {/* 描述 */}
              {prompt.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{prompt.description}</p>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
};

export default PromptPanel;
