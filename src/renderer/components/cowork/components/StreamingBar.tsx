import React from 'react';

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
