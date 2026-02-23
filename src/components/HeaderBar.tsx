import React, { useState, useRef, useEffect } from 'react';
import UserIconSlider from './UserIconSlider';
import type { PageDef } from '../pages/MainPage';
import { useModal } from './ModalContext';
import { useNavigate } from 'react-router-dom';
import { saveUserTheme } from '../services/firestore';
import type { User } from "firebase/auth";
import Logo from './Logo';

interface HeaderBarProps {
    theme: 'dark' | 'light';
    setTheme: React.Dispatch<React.SetStateAction<'dark' | 'light'>>;
    user: User | null;
    setIsauth: React.Dispatch<React.SetStateAction<boolean>>;
    isPaneOpen: boolean;
    setIsPaneOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setUser: React.Dispatch<React.SetStateAction<User | null>>;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
    pages: PageDef[];
}

const HeaderBar: React.FC<HeaderBarProps> = ({
    theme, setTheme, user, setIsauth, isPaneOpen,
    setIsPaneOpen, setUser, setError, pages,
}) => {
    const [isNavOpen, setIsNavOpen] = useState(false);
    const navRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(false);
    const { openModal, closeModal } = useModal();
    const navigate = useNavigate();

    // NOTE: We rely on the global 'dark' class now, but keeping 'isDark' boolean for specific
    // conditional logic inside JS (like icons) is still fine, though we removed it from className strings.
    const isDark = theme === 'dark';

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isNavOpen && navRef.current && !navRef.current.contains(event.target as Node)) {
                setIsNavOpen(false);
                closeModal();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeModal, isNavOpen, openModal]);

    const toggleTheme = async () => {
        const newTheme = theme === "light" ? "dark" : "light";
        setTheme(newTheme);
        if (user) {
            await saveUserTheme(user.uid, newTheme);
        }
    };

    return (
        <>
            <header className="glass-header h-20">
                <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
                    
                    {/* --- Left Side --- */}
                    <div className="flex items-center gap-5">
                        <button
                            onClick={() => { setIsNavOpen(true); openModal(); }}
                            className="group btn-icon-glass"
                        >
                            <div className="space-y-1.5">
                                <span className="block w-6 h-0.5 rounded-full transition-all group-hover:w-4 bg-black dark:bg-current"></span>
                                <span className="block w-6 h-0.5 rounded-full transition-all bg-black dark:bg-current"></span>
                                <span className="block w-4 h-0.5 rounded-full transition-all group-hover:w-6 bg-black dark:bg-current"></span>
                            </div>
                        </button>

                        <div 
                            className="flex items-center gap-3 cursor-pointer select-none group" 
                            onClick={() => navigate('/')}
                        >
                             <div className="w-11 h-11 flex items-center justify-center rounded-xl shadow-lg transition-transform group-hover:scale-105 bg-white border border-gray-200 dark:bg-neutral-900 dark:border-white/10">
                                <Logo className="h-6 w-6" variant="icon" />
                            </div>
                            <span className="hidden sm:block text-brand">Revsy</span>
                        </div>
                    </div>

                    {/* --- Right Side --- */}
                    <div className="flex items-center gap-4">
                        <button
                            onClick={toggleTheme}
                            className="relative w-14 h-8 rounded-full transition-colors duration-300 p-1 flex items-center bg-gray-200 border border-gray-300 dark:bg-neutral-800 dark:border-white/10"
                        >
                            <div className={`absolute w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center bg-white dark:bg-gray-900 ${isDark ? 'translate-x-6' : 'translate-x-0'}`}>
                                <span className={`material-icons text-[14px] ${isDark ? 'text-blue-400' : 'text-orange-400'}`}>
                                    {isDark ? 'dark_mode' : 'light_mode'}
                                </span>
                            </div>
                        </button>

                        {!user ? (
                            <button
                                onClick={() => setIsauth(true)}
                                className="px-5 py-2 rounded-xl text-sm font-bold transition-all shadow-lg hover:-translate-y-0.5 bg-black text-white hover:bg-gray-800 shadow-black/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:shadow-white/10"
                            >
                                Sign In
                            </button>
                        ) : (
                            <UserIconSlider
                                isPaneOpen={isPaneOpen}
                                setIsPaneOpen={setIsPaneOpen}
                                theme={theme}
                                setUser={setUser}
                                loading={loading}
                                setLoading={setLoading}
                                setError={setError}
                            />
                        )}
                    </div>
                </div>
            </header>

            <div
                ref={navRef}
                className={`glass-drawer w-80 ${isNavOpen ? 'translate-x-0 shadow-[0_0_50px_rgba(0,0,0,0.5)]' : '-translate-x-full'}`}
            >
                <div className="flex flex-col h-full">
                    <div className="flex justify-between items-center p-6 mb-2">
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">Navigation</span>
                        <button
                            onClick={() => { setIsNavOpen(false); closeModal(); }}
                            className="p-2 rounded-full transition-colors hover:bg-gray-100 text-gray-500 dark:hover:bg-white/10 dark:text-gray-400"
                        >
                            <span className="material-icons">close</span>
                        </button>
                    </div>

                    <div className="px-4 flex-grow overflow-y-auto">
                        <a 
                            href="/" 
                            className="group flex items-center gap-4 px-4 py-4 rounded-2xl transition-all mb-2 hover:bg-gray-100 text-gray-600 hover:text-black dark:hover:bg-neutral-800 dark:text-gray-300 dark:hover:text-white"
                        >
                            <span className="p-2 rounded-lg transition-colors bg-gray-200 group-hover:bg-white dark:bg-neutral-900 dark:group-hover:bg-neutral-700">
                                <span className="material-icons text-lg">home</span>
                            </span>
                            <span className="font-semibold text-lg">Home</span>
                        </a>
                        
                        <div className="mt-8 pt-8 border-t border-gray-200 dark:border-white/10">
                            <div className="px-4 mb-4 flex items-center gap-2">
                                <span className="material-icons text-sm opacity-50">folder_open</span>
                                <p className="text-xs font-bold uppercase tracking-wider opacity-50">Your Pages</p>
                            </div>
                            
                            <div className="space-y-1">
                                {pages.map(p => (
                                    <a
                                        key={p.id}
                                        href={p.path}
                                        className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-gray-600 hover:text-black hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5"
                                    >
                                        <span className={`w-2 h-2 rounded-full ${p.type === 'problem' ? 'bg-purple-500' : 'bg-cyan-500'}`}></span>
                                        {p.name}
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>
                    
                    <div className="p-6 border-t border-gray-200 dark:border-white/10">
                        <p className="text-xs text-center text-gray-400 dark:text-gray-600">
                            &copy; 2026 icode100 <br />
                            v2.0.1 <br />
                            made with &#10084; by the <a href="https://icode100.github.io">icode100</a>
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
};

export default HeaderBar;