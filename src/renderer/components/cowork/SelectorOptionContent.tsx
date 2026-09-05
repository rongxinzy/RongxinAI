import type { ReactNode } from 'react';

/** Shared presentation only; selection and keyboard behavior belong to the menu primitive. */
export function SelectorOptionContent({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2">
      <span aria-hidden="true" className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="theme-selector-option-title wrap-anywhere">{title}</span>
        {description && (
          <span className="theme-selector-option-description wrap-anywhere">{description}</span>
        )}
      </span>
    </span>
  );
}
