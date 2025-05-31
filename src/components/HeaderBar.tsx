import React, { useState, useRef, useEffect } from 'react';
import UserIconSlider from './UserIconSlider';
import type { PageDef } from '../pages/MainPage';
import type { signInWithEmail, signOut } from '../services/firebaseAuth';
import { useModal } from './ModalContext';
import {useNavigate } from 'react-router-dom';

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;

interface HeaderBarProps {
    theme: 'dark' | 'light';
    setTheme: React.Dispatch<React.SetStateAction<'dark' | 'light'>>;
    user: User | null | void;
    setIsauth: React.Dispatch<React.SetStateAction<boolean>>;
    isPaneOpen: boolean;
    setIsPaneOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setUser: React.Dispatch<React.SetStateAction<User | null | nulluser>>;
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

    // Close nav when clicking outside
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
    const navigate = useNavigate();

    return (
        <div className={`fixed ${theme === 'dark' ? 'bg-gray-300 text-gray-800' : 'bg-gray-800 text-white'}`}>
            {/* Top Bar */}
            <div className="flex align-items-center w-full mt-4 mb-4 z-50">
                <nav className='z-50'>
                    <div className="mt-4 ml-2">
                        {!isNavOpen && (
                            <button
                                onClick={() => { setIsNavOpen(true); openModal(); }}
                                className={` focus:outline-none`}
                            >
                                <span className="material-icons">menu</span>
                            </button>
                        )}
                    </div>

                    {/* Sliding Navigation Pane */}
                    <div
                        ref={navRef}
                        className={`fixed top-0 left-0 h-full ${theme === 'dark' ? 'bg-blue-300 text-black' : 'bg-blue-400 text-white'} transform ${isNavOpen ? 'translate-x-0' : '-translate-x-full'
                            } transition-transform duration-300 ease-in-out w-64`}
                    >

                        {/* Close Nav */}
                        <div className="flex justify-end p-4">
                            <button
                                onClick={() => { setIsNavOpen(false); closeModal();}}
                                className={`focus:outline-none`}
                            >
                                <span className="material-icons">close</span>
                            </button>
                        </div>

                        {/* Nav Links */}
                        <div className={`p-4`}>
                            <a href="/" className="block py-2 hover:underline">Home</a>
                            {pages.map(p => (
                                <a
                                    key={p.id}
                                    href={p.path}
                                    className="block py-2 hover:underline capitalize"
                                >
                                    {p.name}
                                </a>
                            ))}
                        </div>
                    </div>
                </nav>
                
                <div className="grid grid-cols-30 gap-5">
                    <div className='col-span-13'></div>
                    <div className={`col-span-4 text-2xl bold cursor-pointer hover:underline`} onClick={()=>navigate('/')}>Revsy</div>
                    <div className="col-span-7"></div>

                    {/* Theme Toggle */}
                    <div className='col-span-1'>
                        <button
                            onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
                            className={`px-3 py-2 rounded-full ${theme === 'dark'
                                ? 'bg-blue-500 hover:bg-blue-600'
                                : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                        >
                            <span className="material-icons">
                                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
                            </span>
                        </button>
                    </div>

                    <div className="col-span-1"></div>

                    {/* Auth or User Panel */}
                    <div className="col-span-3">
                        {!user ? (
                            <button
                                onClick={() => setIsauth(true)}
                                className={`w-full py-2 hover:underline text-center`}
                            >
                                SignIn/SignUp
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
                {/* Breadcrumb Toggle Button */}
                
            </div>
        </div>


    );
};

export default HeaderBar;
