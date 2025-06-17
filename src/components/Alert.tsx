// components/Alert.tsx
import React, { useEffect, useState } from 'react';

interface AlertProps {
  message: string;
  onClose: () => void;
  type:string;
}

const Alert: React.FC<AlertProps> = ({ message, onClose, type }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Automatically close the alert after 2 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose();
    }, 2000);

    return () => clearTimeout(timer); // Cleanup the timer on unmount
  }, [onClose]);

  if (!isVisible) return null;

  return (
    <div className={`fixed top-25 right-0 transform -translate-x-1/2 ${type==='error'?"bg-red-500":"bg-yellow-500"} text-white px-4 py-2 rounded shadow-lg w-80`}>
      <div className="flex items-center justify-between">
        <span>{message}</span>
      </div>
      {/* Loader animation */}
      <div className={`relative w-full h-1 mt-2 ${type==='error'?"bg-red-300":"bg-yellow-300"} rounded`}>
        <div
          className={`absolute top-0 left-0 h-full ${type==='error'?"bg-red-700":"bg-yellow-700"} rounded animate-time-bar`}          style={{ animationDuration: '2s' }}
        ></div>
      </div>
    </div>
  );
};

export default Alert;
