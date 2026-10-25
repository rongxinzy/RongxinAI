/**
 * Registry icon tile with fallbacks (image → first letter → generic icon).
 * Extracted verbatim from McpManager.tsx (issue #1069).
 */
import { Cable } from 'lucide-react';
import React from 'react';

import { CuteMcpCategoryIcon, type McpCategoryId } from './cuteMcpCategoryIcons';

const McpIcon: React.FC<{
  iconSrc?: string;
  fallbackLabel?: string;
  category?: McpCategoryId;
  fallbackIcon?: React.ComponentType<{ className?: string }>;
  fallbackIconClassName?: string;
  imageClassName?: string;
}> = ({
  iconSrc,
  fallbackLabel,
  category,
  fallbackIcon: FallbackIcon = Cable,
  fallbackIconClassName = 'size-5 text-muted-foreground',
  imageClassName = 'size-9',
}) => (
  <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
    {iconSrc ? (
      <img src={iconSrc} alt="" className={`${imageClassName} object-contain`} />
    ) : category ? (
      <CuteMcpCategoryIcon category={category} className="size-full border-0" />
    ) : fallbackLabel ? (
      <span className="text-lg font-semibold text-foreground">
        {fallbackLabel.trim().charAt(0).toUpperCase()}
      </span>
    ) : (
      <FallbackIcon className={fallbackIconClassName} />
    )}
  </div>
);

export default McpIcon;
