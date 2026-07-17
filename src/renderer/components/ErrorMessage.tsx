import { Button } from '@shared/components/ui/button';
import { TriangleAlert, X } from 'lucide-react';
import React from 'react';

interface ErrorMessageProps {
  message: string;
  onClose?: () => void;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onClose }) => {
  return (
    <div className="flex items-center justify-between bg-linear-to-r from-red-500/90 to-orange-500/90 text-white p-4 rounded-xl shadow-lg m-3 transition-all duration-200">
      <div className="flex items-center space-x-3">
        <TriangleAlert className="h-5 w-5 text-white shrink-0" />
        <span className="text-sm font-medium">{message}</span>
      </div>
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="ml-2 text-white hover:text-red-100 rounded-full p-1 hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
};

export default ErrorMessage;