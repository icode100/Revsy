import React, {useState } from 'react'
import {
    signInWithEmail,
    signInWithGoogle,
    signOut
} from "../services/firebaseAuth";
import { useModal } from './ModalContext';
import GoogleLogo from "/google.png?url"
// import { onAuthStateChanged } from "firebase/auth"; // Import onAuthStateChanged
// import { auth } from "../services/firebaseAuth"; // Import the auth instance

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;

interface SignInProps {
    theme: "dark" | "light";
    isauth: boolean
    setIsauth: (isauth: boolean) => void
    isSignIn: boolean,
    setSignIn: (isSignIn: boolean) => void
    setUser: React.Dispatch<React.SetStateAction<User | null | nulluser>>;
}


const SignIn: React.FC<SignInProps> = ({ theme, isauth, setIsauth, setSignIn, isSignIn, setUser }) => {
    const [info, setInfo] = useState({
        email: "",
        pw: "",
    })
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setInfo(prev => ({
            ...prev,
            [name]: value
        }));
    };
    const { closeModal, openModal } = useModal();
    console.log(isauth);
    if(isauth){
        openModal();
    }else{
        closeModal();
    }

    const handleGoogleLogin = async () => {
        try {
            setLoading(true);
            setError(null);
            const user = await signInWithGoogle();
            setUser(user);
            console.log(typeof user)
            closeModal();
            setIsauth(false);
        } catch (e: unknown) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError('An unknown error occurred')
            }
        }
    }
    const handleSubmit = async () => {
        try {
            setLoading(true);
            setError(null);
            const user = await signInWithEmail(info.email, info.pw);
            setUser(user);
            closeModal();
            setIsauth(false);
        } catch (e: unknown) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError("An unknown error occurred.");
            }
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className={`p-6 rounded-lg shadow-md ${theme === "dark" ? "bg-gray-800 text-white" : "bg-white text-black"
                }`}
        >
            <div className="mb-4">
                <label
                    htmlFor="email"
                    className="block text-sm font-medium mb-2"
                >
                    Email
                </label>
                <input type="email" id="email" name='email' value={info.email} onChange={handleChange}
                    placeholder='Enter Your Mail ID here'
                    className={`flex-1 px-4 py-2 rounded border ${theme === "dark"
                        ? "bg-gray-700 border-gray-600 text-white"
                        : "bg-gray-100 border-gray-300 text-black"
                        }`}
                    required />
            </div>
            <div className="mb-4">
                <label
                    htmlFor="password"
                    className="block text-sm font-medium mb-2"
                >
                    Password
                </label>
                <input
                    id="password"
                    type="password"
                    value={info.pw}
                    onChange={handleChange}
                    name='pw'
                    required
                    className={`w-full px-4 py-2 rounded border ${theme === "dark"
                        ? "bg-gray-700 border-gray-600 text-white"
                        : "bg-gray-100 border-gray-300 text-black"
                        }`}
                />
            </div>
            {error && <p className="text-red-500 mb-4">{error}</p>}
            <button
                type="submit"
                disabled={loading}
                className={`w-full px-4 py-2 rounded mb-4 ${loading
                    ? "bg-gray-400 cursor-not-allowed"
                    : theme === "dark"
                        ? "bg-purple-600 hover:bg-purple-700 text-white"
                        : "bg-purple-500 hover:bg-purple-600 text-white"
                    }`}
            >
                Submit
            </button>
            <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className={`w-full px-4 py-2 rounded mb-4 flex items-center justify-center gap-x-2 ${loading
                    ? "bg-gray-400 cursor-not-allowed"
                    : theme === "dark"
                        ? "bg-gray-600 hover:bg-gray-700 text-white"
                        : "bg-gray-500 hover:bg-gray-600 text-white"
                    }`}
            >
                <img src={GoogleLogo} width={20} alt="Google logo" />
                <span>Sign in with Google</span>
            </button>

            <button className='w-full bg-transperant hover:underline items-center' onClick={() => setSignIn(!isSignIn)}> Don't have an account? Create One</button>

        </form>
    );
}

export default SignIn;