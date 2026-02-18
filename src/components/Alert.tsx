import React, { useEffect } from 'react';

interface AlertProps {
  message: string;
  type: 'error' | 'alert';
  onClose: () => void;
}

const Alert: React.FC<AlertProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 2000);

    return () => clearTimeout(timer);
  }, [onClose]);

  const isError = type === 'error';

  return (
    <div className={`alert-toast ${isError ? 'alert-error' : 'alert-info'}`} role="alert">
      <div className="relative">
        <svg className="loader-svg" viewBox="0 0 36 36">
          <circle
            className="loader-bg"
            strokeWidth="3.5"
            fill="transparent"
            r="16"
            cx="18"
            cy="18"
          />
          <circle
            className="loader-circle"
            strokeWidth="3.5"
            fill="transparent"
            r="16"
            cx="18"
            cy="18"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="material-icons text-[14px]">
            {isError ? 'priority_high' : 'notifications'}
          </span>
        </div>
      </div>

      <span className="font-semibold text-sm flex-grow leading-snug">{message}</span>

      <button 
        onClick={onClose}
        className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"
      >
        <span className="material-icons text-lg">close</span>
      </button>
    </div>
  );
};

export default Alert;