import React from 'react';

const GrokIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Grok"
    role="img"
  >
    <path
      d="M12.4579 15.6036L26.1529 35H20.0656L6.37059 15.6036H12.4579ZM12.4524 26.3764L15.4974 30.6909L12.4551 35H6.36377L12.4524 26.3764ZM33.6365 7.15727V35H28.647V14.2236L33.6365 7.15727ZM33.6365 5L20.0656 24.2205L17.0206 19.9073L27.5451 5H33.6365Z"
      fill="currentColor"
    />
  </svg>
);

export default GrokIcon;
