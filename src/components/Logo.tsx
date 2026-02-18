import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'icon' | 'full'; // 'icon' = just the mark, 'full' = mark + text
}

const Logo: React.FC<LogoProps> = ({ className = "h-8 w-auto", variant = 'full' }) => {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* The Icon Mark */}
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-auto aspect-square"
      >
        <defs>
          <linearGradient id="logo-gradient" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#c084fc" /> {/* Violet */}
            <stop offset="50%" stopColor="#818cf8" /> {/* Indigo */}
            <stop offset="100%" stopColor="#22d3ee" /> {/* Cyan */}
          </linearGradient>
        </defs>

        {/* Vertical Bar (The "Backbone") */}
        <path
          d="M14 12V36"
          stroke="url(#logo-gradient)"
          strokeWidth="5"
          strokeLinecap="round"
        />

        {/* The "R" Loop and Leg - Stylized as a Circuit Path */}
        <path
          d="M14 16H24C29.5228 16 34 20.4772 34 26C34 31.5228 29.5228 36 24 36H14"
          stroke="url(#logo-gradient)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity="0.4"
        />
        
        {/* The "Kick" - Sharp and defined */}
        <path
          d="M26 29L34 36"
          stroke="url(#logo-gradient)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Connection Dot (Tech accent) */}
        <circle cx="34" cy="36" r="3" fill="#22d3ee" />
      </svg>
      
      {/* The Text - Only shown if variant is 'full' */}
      {variant === 'full' && (
        <span className="text-2xl font-bold tracking-tight select-none">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">
                Revsy
            </span>
        </span>
      )}
    </div>
  );
};

export default Logo;