// /* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
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
import {
  addPageToDB,
  getAllPages,
  deletePageAndComponents,
  getUserTheme
} from './services/firestore';


type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;

function App() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [pages, setPages] = useState<PageDef[]>([]);
  const [isauth, setIsauth] = useState<boolean>(false);
  const { closeModal } = useModal();
  const [user, setUser] = useState<User | null | nulluser>(null);
  const [isPaneOpen, setIsPaneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const handleCloseAlert = () => {
    setError(null);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setTheme(await getUserTheme(currentUser.uid))
        try {
          const pagesFromDB = await getAllPages(currentUser.uid);
          setPages(pagesFromDB);
        } catch (err) {
          console.error(err);
          setError("Failed to load pages.");
        }
      } else {
        setUser(null);
        setPages([]); // Clear pages on logout
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addPage = async (type: PageDef['type'], name: string) => {
    if (!user) return; // Must be logged in
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
    const newPage: PageDef = {
      id: Date.now(),
      name,
      type,
      path: `/user/${user.uid}/${type}/${Date.now()}/${slug}`,
    };
    try {
      await addPageToDB(user.uid, newPage);
      setPages(prev => [...prev, newPage]);
    } catch (err) {
      console.error(err);
      setError("Failed to add page.");
    }
  };

  const deletePage = async (id: number) => {
    if (!user) return;
    try {
      await deletePageAndComponents(user.uid, id);
      setPages(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error(err);
      setError("Failed to delete page.");
    }
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
        {
          loading ? (
            <div className="text-center mt-20">Loading...</div>
          ) : (
            <Routes>
              <Route
                path="/"
                element={
                  user ? <Navigate to={`/user/${user.uid}`} replace /> : <MainPage pages={pages} addPage={addPage} theme={theme} deletePage={deletePage} error={error} setError={setError} user={user} />
                }
              />
              <Route
                path={`/user/${user ? user.uid : ""}`}
                element={
                  <MainPage pages={pages} addPage={addPage} theme={theme} deletePage={deletePage} error={error} setError={setError} user={user} />
                }
              />
              {pages.map(p => (
                <Route
                  key={p.id}
                  path={p.path}
                  element={
                    p.type === 'problem'
                      ? <ProblemsPage theme={theme} pageId={p.id} user={user} setError={setError} name={p.name}/>
                      : <ConceptsPage theme={theme} pageId={p.id} user={user} setError={setError} name={p.name}/>
                  }
                />
              ))}
              {/* 404 Page */}
              <Route
                path="*"
                element={
                  <div
                    className={`min-h-screen p-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'
                      }`}
                  >
                    <div className='mt-50 place-items-center text-5xl'>
                      <h1 className="text-4xl font-bold">404 - Page Not Found</h1>
                      <p className="mt-4">The page you are looking for does not exist.</p>
                      <a href="/" className="mt-6 inline-block px-4 py-2 text-white rounded hover:underline">
                        Go to Home
                      </a>
                    </div>
                  </div>
                }
              />
            </Routes>)}
      </BrowserRouter>
    </>
  );
}

export default App;
