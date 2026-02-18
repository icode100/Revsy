import React from 'react';
import { signOut } from '../services/firebaseAuth';
import { useNavigate } from 'react-router-dom';
import type { User } from "firebase/auth";

interface UserIconSliderProps {
  isPaneOpen: boolean;
  setIsPaneOpen: (isPaneOpen: boolean) => void;
  theme: "dark" | "light"
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

const UserIconSlider: React.FC<UserIconSliderProps> = ({ isPaneOpen, setIsPaneOpen, setUser, loading, setLoading, setError, theme }) => {
  const navigate = useNavigate();
  const isDark = theme === 'dark';

  const togglePane = () => {
    setIsPaneOpen(!isPaneOpen);
  };

  const handleLogout = async (e: React.MouseEvent) => {
    e.stopPropagation(); 
    try {
      setLoading(true);
      setError(null);
      await signOut();
      setUser(null);
      setLoading(false);
      navigate('/');
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("An unknown error occurred.");
      }
    }
  };

  return (
    <div 
      className={`
        relative flex items-center justify-end p-1 rounded-full transition-all duration-300 border
        ${isPaneOpen ? 'w-32' : 'w-10'}
        ${isDark 
          ? 'bg-neutral-900 border-white/10 shadow-lg shadow-purple-500/10' 
          : 'bg-white border-gray-200 shadow-sm'
        }
      `}
      onClick={togglePane}
    >
      <div 
        className={`
          absolute left-1 flex items-center overflow-hidden transition-all duration-300
          ${isPaneOpen ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-2 w-0 pointer-events-none'}
        `}
      >
         <button 
            onClick={handleLogout}
            disabled={loading}
            className="p-1 px-2 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors text-xs font-bold flex items-center gap-1"
         >
            <span className="material-icons text-[14px]">logout</span>
            <span>Exit</span>
         </button>
      </div>

      <button
        className={`
          w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform duration-300 z-10
          ${isPaneOpen ? 'rotate-90 scale-90' : 'rotate-0'}
          bg-gradient-to-tr from-orange-400 to-pink-500
        `}
      >
        <span className="material-icons text-sm">{loading ? 'sync' : 'person'}</span>
      </button>
    </div>
  );
};

export default UserIconSlider;