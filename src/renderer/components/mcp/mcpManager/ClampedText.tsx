/**
 * Text with line-clamp-2 that shows a popover above the text when truncated.
 * Extracted verbatim from McpManager.tsx (issue #1069).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

const ClampedText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const checkClamp = useCallback(() => {
    const el = textRef.current;
    if (el) setIsClamped(el.scrollHeight > el.clientHeight + 1);
  }, []);

  useEffect(() => {
    checkClamp();
    window.addEventListener('resize', checkClamp);
    return () => window.removeEventListener('resize', checkClamp);
  }, [text, checkClamp]);

  const handleEnter = () => {
    if (!isClamped) return;
    timerRef.current = setTimeout(() => setShowFull(true), 400);
  };

  const handleLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowFull(false);
  };

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <p ref={textRef} className={`line-clamp-2 ${className}`}>
        {text}
      </p>
      {showFull && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 z-50
          rounded-lg px-3 py-2 text-xs leading-relaxed
          bg-surface-raised text-foreground
          shadow-lg border border-border"
        >
          {text}
        </div>
      )}
    </div>
  );
};

export default ClampedText;
