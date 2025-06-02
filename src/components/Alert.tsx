// components/Alert.tsx
import React, { useEffect } from 'react';

interface AlertProps {
  message: string;
  onClose: () => void;
}

const Alert: React.FC<AlertProps> = ({ message, onClose }) => {
  useEffect(() => {
    const handleClick = () => {
      onClose();
    };

    // Add event listener to the window object
    window.addEventListener('click', handleClick);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  return (
    <div className="fixed top-20 right-10 bg-red-500 text-white px-4 py-2 rounded shadow-lg z-50">
      {message}
    </div>
  );
};

export default Alert;
