import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { RootState } from '../../store';
import { selectPrompt } from '../../store/slices/quickActionSlice';
import type { LocalizedPrompt } from '../../types/quickAction';
import CaseDetailDialog from './CaseDetailDialog';

interface CaseGalleryProps {
  prompts: LocalizedPrompt[];
  onPromptSelect: (prompt: string) => void;
  capabilityLabel?: string;
}

/**
 * 案例库网格。
 *
 * 缩略图是可选数据：只有带 preview 的案例渲染预览区，其余案例只渲染文字卡片。
 * 预览区按 8:5 留位，与 public/case-previews 的缩略图比例一致，避免 cover 裁掉页面底部内容。
 * 标题排在缩略图下方（不叠在图上，也不需要遮罩），说明保留在详情中：点击案例只打开详情，
 * 草稿要等用户在详情里确认才写入。
 */
const CaseGallery: React.FC<CaseGalleryProps> = ({ prompts, onPromptSelect, capabilityLabel }) => {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewPrompt = prompts.find(prompt => prompt.id === previewId);
  const dispatch = useDispatch();
  const selectedPromptId = useSelector((state: RootState) => state.quickAction.selectedPromptId);

  const handleSelect = (prompt: LocalizedPrompt) => {
    setPreviewId(null);
    dispatch(selectPrompt(prompt.id));
    onPromptSelect(prompt.prompt);
  };

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {prompts.map(prompt => {
          const isSelected = selectedPromptId === prompt.id;

          return (
            <button
              key={prompt.id}
              type="button"
              aria-haspopup="dialog"
              aria-current={isSelected ? 'true' : undefined}
              data-selected={isSelected ? 'true' : undefined}
              title={prompt.description || prompt.label}
              onClick={() => setPreviewId(prompt.id)}
              className="theme-page-case-gallery-card group flex w-full flex-col text-left"
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

              {/* min-w-0 + block：标题在 flex/grid 子项里默认 min-width:auto，长标题会把列撑宽
                  且不出现省略号；块级 + min-w-0 才能按卡片宽度截断。 */}
              <span className="theme-page-case-gallery-body block min-w-0">
                <span className="block truncate">{prompt.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      {previewPrompt && (
        <CaseDetailDialog
          key={previewPrompt.id}
          prompt={previewPrompt}
          capabilityLabel={capabilityLabel}
          onClose={() => setPreviewId(null)}
          onUse={() => handleSelect(previewPrompt)}
        />
      )}
    </>
  );
};

export default CaseGallery;
