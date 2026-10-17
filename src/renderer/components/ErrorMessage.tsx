import React from 'react';
import { reportError } from '../services/errorNormalization';
import { showAppToast } from '../services/toastNotification';

interface ErrorMessageProps {
  message: string;
  onClose?: () => void;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onClose }) => {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    const normalized = reportError(message);
    showAppToast({
      message: normalized,
      isError: true,
      durationMs: 5000,
      onClose: () => onCloseRef.current?.(),
    });
  }, [message]);

  return null;
};

export default ErrorMessage;
