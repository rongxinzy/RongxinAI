import React from 'react';

interface ErrorMessageProps {
  message: string;
  onClose?: () => void;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onClose }) => {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('app:showToast', {
        detail: {
          message,
          durationMs: 5000,
          isError: true,
          onClose: () => onCloseRef.current?.(),
        },
      }),
    );
  }, [message]);

  return null;
};

export default ErrorMessage;
