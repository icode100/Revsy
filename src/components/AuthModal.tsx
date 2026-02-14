import React, { useState } from 'react'
import SignIn from './SignIn'
import SignUp from './SignUp';
import type { User } from "firebase/auth";


interface AuthModalProps {
    theme: "dark" | "light";
    isauth: boolean
    setIsauth: (auth: boolean) => void
    setUser: React.Dispatch<React.SetStateAction<User | null>>;
}


const AuthModal: React.FC<AuthModalProps> = ({ theme, isauth, setIsauth, setUser}) => {
    const [isSignIn,setSignIn] = useState(true);
    return (
        <div className={`rounded-lg shadow-lg p-6 w-full max-w-lg max-h-screen overflow-y-auto ${theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-gray-50 text-black'
                            }`} onClick={(e) => e.stopPropagation()}>
            {
                isSignIn?(
                    <div>
                        <h2 className="text-xl font-bold mb-4">SignIn</h2>
                        <SignIn theme={theme} isauth={isauth} setIsauth={setIsauth} isSignIn={isSignIn} setSignIn={setSignIn} setUser={setUser}/>
                    </div>
                ):(
                    <div>
                        <h2 className="text-xl font-bold mb-4">SignUp</h2>
                        <SignUp theme={theme} isauth={isauth} setIsauth={setIsauth} isSignIn={isSignIn} setSignIn={setSignIn} setUser={setUser}/>
                    </div>
                )
            }
        </div>
    )
    
    
}

export default AuthModal;