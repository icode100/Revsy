import React, { useState, useRef, useEffect } from 'react';
interface NavbarProps {
    theme: "dark" | "light";
}
const Navbar: React.FC<NavbarProps> = ({theme}) => {
    const [isNavOpen, setIsNavOpen] = useState(false);
    const navRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (navRef.current && !navRef.current.contains(event.target as Node)) {
                setIsNavOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const toggleNav = () => {
        setIsNavOpen(!isNavOpen);
    };

    return (
        <nav>
            <div className="m-4">
                {/* Breadcrumb Icon */}
                {!isNavOpen && (
                    <button
                        onClick={toggleNav}
                        className={`${theme==='dark'?"text-gray-800":"text-gray-50"} focus:outline-none`}
                    >
                        <span className="material-icons">menu</span>
                    </button>
                )}
            </div>

            {/* Sliding Navigation Pane */}
            <div
                ref={navRef}
                className={`fixed top-0 left-0 h-full ${theme==='dark'?"bg-gray-700":"bg-gray-300"} text-white transform ${
                    isNavOpen ? 'translate-x-0' : '-translate-x-full'
                } transition-transform duration-300 ease-in-out w-64`}
            >
                {/* Close Button Inside Navigation Pane */}
                <div className="flex justify-end p-4">
                    <button
                        onClick={toggleNav}
                        className={`${theme==="dark"?"text-white": "text-gray-700"} focus:outline-none`}
                    >
                        <span className="material-icons">close</span>
                    </button>
                </div>

                {/* Navigation Links */}
                <div className={`p-4 ${theme==="dark"?"text-white": "text-gray-700"} `}>
                    <a href="#" className={`block py-2 hover:underline`}>
                        Home
                    </a>
                    <a href="#" className={`block py-2 hover:underline`}>
                        About
                    </a>
                    <a href="#" className={`block py-2 hover:underline`}>
                        Services
                    </a>
                    <a href="#" className={`block py-2 hover:underline`}>
                        Contact
                    </a>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;