import { cn } from '@shared/lib/utils';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { RootState } from '../../store';
import { selectPrompt } from '../../store/slices/quickActionSlice';
import type { LocalizedPrompt } from '../../types/quickAction';

interface CaseGalleryProps {
  prompts: LocalizedPrompt[];
  onPromptSelect: (prompt: string) => void;
}

/**
 * 案例库网格。
 *
 * 缩略图是可选数据：只有带 preview 的案例渲染预览区，其余案例只渲染文字卡片。
 * 预览区按 8:5 留位，与 public/case-previews 的缩略图比例一致，避免 cover 裁掉页面底部内容。
 * 卡片自身不画边框和底板，只有 hover 与选中态由主题 recipe 叠一层圆角底色，缩略图因此是
 * 这一格里唯一的实心块。网格按内容高度对齐：无缩略图的文字卡不会被同行的预览卡拉伸。
 */
const CaseGallery: React.FC<CaseGalleryProps> = ({ prompts, onPromptSelect }) => {
  const dispatch = useDispatch();
  const selectedPromptId = useSelector((state: RootState) => state.quickAction.selectedPromptId);

  const handleSelect = (prompt: LocalizedPrompt) => {
    dispatch(selectPrompt(prompt.id));
    onPromptSelect(prompt.prompt);
  };

  return (
    <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {prompts.map(prompt => {
        const isSelected = selectedPromptId === prompt.id;

        return (
          <button
            key={prompt.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => handleSelect(prompt)}
            className="theme-page-case-gallery-card group flex w-full flex-col overflow-hidden text-left"
          >
            {prompt.preview && (
              <span className="theme-page-case-gallery-media aspect-[8/5] block w-full overflow-hidden">
                <img
                  src={prompt.preview}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover object-top"
                />
              </span>
            )}

            <span className="theme-page-case-gallery-body flex flex-col">
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  isSelected ? 'text-primary' : 'text-foreground',
                )}
              >
                {prompt.label}
              </span>
              {prompt.description && (
                <span className="text-xs text-muted-foreground line-clamp-1">
                  {prompt.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default CaseGallery;
