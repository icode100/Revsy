import React, { useState } from 'react'
import SignIn from './SignIn'
import SignUp from './SignUp';
 
interface AuthModalProps {
    theme: "dark" | "light";
    auth: boolean
    setAuth: (auth: boolean) => void
}


const AuthModal: React.FC<AuthModalProps> = ({ theme, auth, setAuth }) => {
    const [isSignIn,setSignIn] = useState(true);
    return (
        <div className={`rounded-lg shadow-lg p-6 w-full max-w-lg max-h-screen overflow-y-auto ${theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-gray-50 text-black'
                            }`} onClick={(e) => e.stopPropagation()}>
            {
                isSignIn?(
                    <div>
                        <h2 className="text-xl font-bold mb-4">SignIn</h2>
                        <SignIn theme={theme} auth={auth} setAuth={setAuth} isSignIn={isSignIn} setSignIn={setSignIn}/>
                    </div>
                ):(
                    <div>
                        <h2 className="text-xl font-bold mb-4">SignUp</h2>
                        <SignUp theme={theme} auth={auth} setAuth={setAuth} isSignIn={isSignIn} setSignIn={setSignIn}/>
                    </div>
                )
            }
        </div>
    )
    
    
}

export default AuthModal;