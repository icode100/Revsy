import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  updateProfile,
  signOut as firebaseSignOut,
  // signInWithRedirect
} from "firebase/auth";
import { app } from "./firebase"; // your existing firebase.ts

export const auth = getAuth(app);

// OAuth providers
export const googleProvider = new GoogleAuthProvider();

// Email/Password sign-up
export async function signUpWithEmail(
  name: string,
  email: string,
  password: string
) {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(user, { displayName: name });
  return user;
}

// Email/Password sign-in
export async function signInWithEmail(
  email: string,
  password: string
) {
  const{user} = await signInWithEmailAndPassword(auth, email, password);
  return user;
}

// OAuth sign-in
export async function signInWithGoogle() {
  const{user} = await signInWithPopup(auth, googleProvider);
  return user;
}

// Sign-out
export function signOut() {
  return firebaseSignOut(auth);
}