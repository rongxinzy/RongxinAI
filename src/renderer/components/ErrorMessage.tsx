import React from 'react';
import { reportError } from '../services/errorNormalization';

interface ErrorMessageProps {
  message: string;
  onClose?: () => void;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onClose }) => {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    const normalized = reportError(message);
    window.dispatchEvent(
      new CustomEvent('app:showToast', {
        detail: {
          message: normalized,
          isError: true,
          durationMs: 5000,
          onClose: () => onCloseRef.current?.(),
        },
      }),
    );
  }, [message]);

  return null;
};

export default ErrorMessage;
