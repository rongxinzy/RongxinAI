import React from 'react';

export const TypingDots: React.FC = () => (
  <div className="flex items-center space-x-1.5 py-1">
    <div
      className="w-2 h-2 rounded-full bg-primary animate-bounce"
      style={{ animationDelay: '0ms' }}
    />
    <div
      className="w-2 h-2 rounded-full bg-primary animate-bounce"
      style={{ animationDelay: '150ms' }}
    />
    <div
      className="w-2 h-2 rounded-full bg-primary animate-bounce"
      style={{ animationDelay: '300ms' }}
    />
  </div>
);

export const ArtifactPanelIcon: React.FC<React.SVGProps<SVGSVGElement> & { open?: boolean }> = ({
  open,
  ...props
}) => {
  const dividerX = open ? 10.5 : 12.5;
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="1.5" y="2" width="13" height="12" rx="2" />
      <line x1={dividerX} y1="2" x2={dividerX} y2="14" />
    </svg>
  );
};
