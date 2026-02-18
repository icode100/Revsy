import React, { useState } from 'react';
import {
    signUpWithEmail,
    signInWithGoogle,
} from "../services/firebaseAuth";
import { useModal } from './ModalContext';
import GoogleLogo from '/google.png?url';
import type { User } from "firebase/auth";

interface SignUpProps {
    theme: "dark" | "light";
    isauth: boolean;
    setIsauth: (isauth: boolean) => void;
    isSignIn: boolean;
    setSignIn: (isSignIn: boolean) => void;
    setUser: React.Dispatch<React.SetStateAction<User | null>>;
}

const SignUp: React.FC<SignUpProps> = ({ isauth, setIsauth, setSignIn, isSignIn, setUser }) => {
    const [info, setInfo] = useState({ name: "", dob: "", email: "", pw: "", confirmpw: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setInfo(prev => ({ ...prev, [name]: value }));
    };

    const { closeModal, openModal } = useModal();
    if (isauth) openModal(); else closeModal();

    const handleGoogleLogin = async (e: React.MouseEvent) => {
        e.preventDefault();
        try {
            setLoading(true);
            setError(null);
            const user = await signInWithGoogle();
            setUser(user);
            closeModal();
            setIsauth(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'An unknown error occurred');
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (info.pw !== info.confirmpw) {
            setError("Passwords do not match.");
            return;
        }
        try {
            setLoading(true);
            setError(null);
            const user = await signUpWithEmail(info.name, info.email, info.pw);
            setUser(user);
            closeModal();
            setIsauth(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "An unknown error occurred.");
            setLoading(false);
        }
    };

    return (
        <div className="w-full max-w-xl mx-auto">
             <form onSubmit={handleSubmit} className="glass-panel p-8 sm:p-10 rounded-3xl shadow-2xl relative overflow-hidden">
                {/* Decorative background glow */}
                <div className="absolute top-0 right-0 -mt-10 -mr-10 w-32 h-32 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-32 h-32 bg-purple-500/20 rounded-full blur-3xl pointer-events-none"></div>

                <div className="text-center mb-6 relative z-10">
                    <h2 className="text-3xl font-bold mb-2 tracking-tight">Create Account</h2>
                    <p className="text-sm opacity-60">Join Revsy and start building knowledge</p>
                </div>

                <div className="space-y-4 relative z-10">
                    <div>
                        <label htmlFor="name" className="label-text">Name</label>
                        <input id="name" value={info.name} type='text' name='name' onChange={handleChange} required placeholder="John Doe" className="input-field" />
                    </div>
                    
                    <div>
                         <label htmlFor="dob" className="label-text">Date of Birth</label>
                        <input id="dob" value={info.dob} type='date' name='dob' onChange={handleChange} required className="input-field" />
                    </div>

                    <div>
                        <label htmlFor="email" className="label-text">Email</label>
                        <input type="email" id="email" name='email' value={info.email} onChange={handleChange} placeholder='you@example.com' className="input-field" required />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="password" className="label-text">Password</label>
                            <input id="password" type="password" value={info.pw} onChange={handleChange} name='pw' required placeholder="••••••" className="input-field" />
                        </div>
                        <div>
                             <label htmlFor="cnfpassword" className="label-text">Confirm</label>
                            <input id="cnfpassword" value={info.confirmpw} type='password' name='confirmpw' onChange={handleChange} required placeholder="••••••" className="input-field" />
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center font-medium">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className={`btn-gradient w-full py-3.5 rounded-xl font-bold text-lg tracking-wide shadow-lg mt-2 hover:scale-[1.02] active:scale-[0.98] transition-transform ${loading ? "opacity-70 cursor-wait" : ""}`}
                    >
                         {loading ? 'Creating Account...' : 'Sign Up'}
                    </button>

                    <div className="relative flex py-2 items-center">
                        <div className="divider-line"></div>
                        <span className="flex-shrink mx-4 text-xs font-medium uppercase opacity-50">Or</span>
                        <div className="divider-line"></div>
                    </div>

                    <button onClick={handleGoogleLogin} disabled={loading} className="btn-secondary">
                        <img src={GoogleLogo} width={20} height={20} alt="Google" className="opacity-90" />
                        <span>Google</span>
                    </button>

                    <div className="text-center mt-4">
                        <button type="button" className="link-text" onClick={() => setSignIn(!isSignIn)}>
                            Already have an account? <span className="text-purple-500 hover:underline">Sign In</span>
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}

export default SignUp;