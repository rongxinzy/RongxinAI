/** A document outline whose body lines are drawn on hover and remain visible at rest. */
export function DocumentWritingIcon() {
  return (
    <svg
      aria-hidden="true"
      className="chat-skill-document-icon size-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path
        className="chat-skill-document-icon__line chat-skill-document-icon__line--one"
        d="M8 13h8"
      />
      <path
        className="chat-skill-document-icon__line chat-skill-document-icon__line--two"
        d="M8 16h8"
      />
      <path
        className="chat-skill-document-icon__line chat-skill-document-icon__line--three"
        d="M8 19h5"
      />
    </svg>
  );
}
