// /* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from "react-router";
import MainPage, { type PageDef } from './pages/MainPage';
import ProblemsPage from "./pages/ProblemsPage";
import AuthModal from './components/AuthModal';
import { useModal } from './components/ModalContext';
import { signInWithEmail, signOut } from './services/firebaseAuth';
// import TopBar from './components/TopBar';
import Alert from './components/Alert';
// import Navbar from './components/Navbar';
import ConceptsPage from './pages/ConceptsPage';
import HeaderBar from './components/HeaderBar';
import { onAuthStateChanged } from "firebase/auth"; // Import onAuthStateChanged
import { auth } from "./services/firebaseAuth"; // Import the auth instance

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;

function App() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [pages, setPages] = useState<PageDef[]>([]);
  const deletePage = (id: number) => {
    setPages(prev => prev.filter(p => p.id !== id));
  };
  const [isauth, setIsauth] = useState<boolean>(false);
  const { closeModal } = useModal();
  const [user, setUser] = useState<User | null | nulluser>(null);
  const [isPaneOpen, setIsPaneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleCloseAlert = () => {
    setError(null);
  };

  useEffect(
    () => {
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (currentUser) {
          setUser(currentUser)
        } else {
          setUser(null);
        }
      });

      if (user !== null) {
        const user_id: string = user!.uid;
        console.log(user_id);
      }
      return () => unsubscribe();
    }, [user]
  )
  const addPage = (type: PageDef['type'], name: string) => {
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
    const path = `/${slug}`;
    setPages(ps => [
      ...ps,
      { id: Date.now(), type, name, path }
    ]);
  };
  return (
    <>
      <BrowserRouter>
        {/* navbar */}

        {/* topbar */}
        {/* Toggle Button */}
        <HeaderBar theme={theme}
          setTheme={setTheme}
          user={user}
          setUser={setUser}
          setIsauth={setIsauth}
          isPaneOpen={isPaneOpen}
          setIsPaneOpen={setIsPaneOpen}
          setError={setError}
          pages={pages}
        />
        {error && <Alert message={error} onClose={handleCloseAlert} />}
        {
          isauth && (
            <div
              className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50"
              onClick={() => { setIsauth(false); closeModal(); }}
            >
              <AuthModal theme={theme} isauth={isauth} setIsauth={setIsauth} setUser={setUser} />
            </div>
          )
        }


        {/* Routes */}
        <Routes>
          <Route
            path="/"
            element={
              <MainPage pages={pages} addPage={addPage} theme={theme} deletePage={deletePage} />
            }
          />
          {pages.map(p => (
            p.type === 'problem'
              ? <Route key={p.id} path={p.path} element={<ProblemsPage theme={theme} />} />
              : <Route key={p.id} path={p.path} element={<ConceptsPage theme={theme} />} />
          ))}
        </Routes>
      </BrowserRouter>
    </>
  );
}

export default App;
