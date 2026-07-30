/** Semantic sidebar icons for the expert library and on-device model runtime. */
export function ExpertProfileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="sidebar-expert-icon size-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle cx="9" cy="9" r="3" />
      <path d="M3.75 19c.85-3.15 2.92-5 5.25-5s4.4 1.85 5.25 5" />
      <g className="sidebar-expert-icon__spark">
        <path d="M18 3.5v5" />
        <path d="M15.5 6h5" />
      </g>
      <path d="m16.2 13.7 1.15 1.15 2.3-2.3" />
    </svg>
  );
}

export function LocalInferenceIcon() {
  return (
    <svg
      aria-hidden="true"
      className="sidebar-local-inference-icon size-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M5.5 7.5 12 4l6.5 3.5v9L12 20l-6.5-3.5z" />
      <path d="M5.5 7.5 12 11l6.5-3.5" />
      <path d="M12 11v9" />
      <circle
        className="sidebar-local-inference-icon__node sidebar-local-inference-icon__node--input"
        cx="8"
        cy="9"
        r=".7"
      />
      <circle
        className="sidebar-local-inference-icon__node sidebar-local-inference-icon__node--core"
        cx="12"
        cy="13"
        r=".7"
      />
      <circle
        className="sidebar-local-inference-icon__node sidebar-local-inference-icon__node--output"
        cx="16"
        cy="9"
        r=".7"
      />
    </svg>
  );
}
