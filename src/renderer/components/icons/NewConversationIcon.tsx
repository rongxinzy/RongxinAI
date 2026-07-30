/** Message-circle-plus icon with a one-shot plus-sign drawing animation. */
export function NewConversationIcon() {
  return (
    <svg
      aria-hidden="true"
      className="sidebar-new-conversation-icon size-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      <path
        className="sidebar-new-conversation-icon__line sidebar-new-conversation-icon__line--horizontal"
        d="M8 12h8"
      />
      <path
        className="sidebar-new-conversation-icon__line sidebar-new-conversation-icon__line--vertical"
        d="M12 8v8"
      />
    </svg>
  );
}
