import React from 'react';

/**
 * Custom icon family for the prompt "+" menu.
 *
 * Hand-drawn on a 16px grid with a shared stroke language (1.5px stroke,
 * round caps/joins, currentColor) so the menu reads as one cohesive set
 * rather than a mix of stock icons. Deliberate project-convention
 * exception: the user asked for bespoke menu icons here.
 */

interface PlusMenuIconProps {
  className?: string;
}

const baseProps = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** 文件和图片：带太阳与山峦的图片框。 */
export const PlusMenuFilesIcon: React.FC<PlusMenuIconProps> = ({ className }) => (
  <svg {...baseProps} className={className}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="5.4" cy="6.3" r="1.1" />
    <path d="M2.6 11.4l2.9-2.7 2.3 2 2.7-2.4 3 2.3" />
  </svg>
);

/** 技能：四角星光。 */
export const PlusMenuSkillsIcon: React.FC<PlusMenuIconProps> = ({ className }) => (
  <svg {...baseProps} className={className}>
    <path d="M8 2.2l1.6 4.1 4.1 1.6-4.1 1.6L8 13.8l-1.6-4.3-4.1-1.6 4.1-1.6z" />
    <path d="M12.6 11.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
  </svg>
);

/** 会话专家：学位帽人物（学者意象）。 */
export const PlusMenuExpertsIcon: React.FC<PlusMenuIconProps> = ({ className }) => (
  <svg {...baseProps} className={className}>
    <path d="M8 2.4l6 2.5-6 2.5-6-2.5z" />
    <path d="M5.3 6.3v2.2c0 1 1.2 1.7 2.7 1.7s2.7-.7 2.7-1.7V6.3" />
    <path d="M14 5v2.8" />
    <path d="M3.7 13.8c.7-1.9 2.3-2.9 4.3-2.9s3.6 1 4.3 2.9" />
  </svg>
);

/** 连接器：两个节点与一条连接线。 */
/** 管理：三行滑杆。 */
export const PlusMenuManageIcon: React.FC<PlusMenuIconProps> = ({ className }) => (
  <svg {...baseProps} className={className}>
    <path d="M2 4.2h12M2 8h12M2 11.8h12" />
    <circle cx="10" cy="4.2" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="5.5" cy="8" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="11.5" cy="11.8" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

/** 技能行缺省图标：小星光。 */
export const PlusMenuSkillGlyphIcon: React.FC<PlusMenuIconProps> = ({ className }) => (
  <svg {...baseProps} className={className}>
    <path d="M8 3l1.3 3.2 3.2 1.3-3.2 1.3L8 12l-1.3-3.2-3.2-1.3 3.2-1.3z" />
  </svg>
);

/** 专家行缺省图标：人物。 */
export const PlusMenuExpertGlyphIcon: React.FC<PlusMenuIconProps> = ({ className }) => (
  <svg {...baseProps} className={className}>
    <circle cx="8" cy="5.4" r="2.4" />
    <path d="M3.4 13.4c.8-2.5 2.5-3.8 4.6-3.8s3.8 1.3 4.6 3.8" />
  </svg>
);
