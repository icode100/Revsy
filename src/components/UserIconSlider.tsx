// components/UserIconSlider.tsx
import React from 'react';
import { signOut } from '../services/firebaseAuth';
import type { signInWithEmail } from '../services/firebaseAuth';
import { useNavigate } from 'react-router-dom';
type nulluser = Awaited<ReturnType<typeof signOut>>;

type User = Awaited<ReturnType<typeof signInWithEmail>>;
interface UserIconSliderProps {
  isPaneOpen: boolean;
  setIsPaneOpen: (isPaneOpen: boolean) => void;
  theme: "dark" | "light"
  setUser: React.Dispatch<React.SetStateAction<User | null | nulluser>>;
  loading:boolean,
  setLoading:(loading:boolean)=>void
  setError:React.Dispatch<React.SetStateAction<string | null>>
}

const UserIconSlider: React.FC<UserIconSliderProps> = ({ isPaneOpen, setIsPaneOpen, setUser, loading, setLoading, setError }) => {
  const togglePane = () => {
    setIsPaneOpen(!isPaneOpen);
  };
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      setLoading(true);
      setError(null);
      const user = await signOut();
      setUser(user);
      console.log(user)
      console.log(typeof user);
      setLoading(false);
      navigate('/');
      // setUser(user);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("An unknown error occurred.");
      }
    }
  };
  return (
    <div className="relative flex items-center space-x-2">
      {/* Profile Icon */}
      <button
        onClick={togglePane}
        className={`rounded-full py-2 px-3 bg-orange-600 hover:bg-orange-700 transition-colors duration-300 ${loading?"disable":""}`}
      >
        <span className="material-icons">person</span>
      </button>

      {/* Sliding Buttons */}
      <div
        className={`flex items-center space-x-2 transition-all duration-300 ease-in-out ${isPaneOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none'
          }`}
      >
        <button onClick={handleLogout} className={`px-3 py-2 bg-red-500 rounded-full hover:bg-red-600 transition-colors duration-300 ${loading?"disable":""}`}>
          <span className="material-icons">logout</span>
        </button>
      </div>
    </div>
  );
};

export default UserIconSlider;
