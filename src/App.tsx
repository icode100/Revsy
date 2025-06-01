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
      path: `/${slug}`,
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
          ) : (<Routes>
            <Route
              path="/"
              element={
                <MainPage pages={pages} addPage={addPage} theme={theme} deletePage={deletePage} />
              }
            />
            {pages.map(p => (
              p.type === 'problem'
                ? <Route key={p.id} path={p.path} element={<ProblemsPage theme={theme}/>} />
                : <Route key={p.id} path={p.path} element={<ConceptsPage theme={theme} pageId = {p.id} user={user}/>} />
            ))}
          </Routes>)}
      </BrowserRouter>
    </>
  );
}

export default App;
