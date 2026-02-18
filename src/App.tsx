import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";

import MainPage, { type PageDef } from "./pages/MainPage";
import ProblemsPage from "./pages/ProblemsPage";
import ConceptsPage from "./pages/ConceptsPage";
import PublicProblemsPage from "./pages/PublicProblemsPage";
import PublicConceptsPage from "./pages/PublicConceptsPage";
import type { User } from "firebase/auth";

import AuthModal from "./components/AuthModal";
import Alert from "./components/Alert";
import HeaderBar from "./components/HeaderBar";
import { useModal } from "./components/ModalContext";

import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./services/firebaseAuth";
import {
  addPageToDB,
  getAllPages,
  deletePageAndComponents,
  getUserTheme,
} from "./services/firestore";

function App() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [pages, setPages] = useState<PageDef[]>([]);
  const [isauth, setIsauth] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isPaneOpen, setIsPaneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { closeModal } = useModal();

  /**
   * DYNAMIC FAVICON LOGIC
   * This effect updates the browser tab icon to match the Logo component.
   */
  useEffect(() => {
    // 1. Define the SVG matching your Logo.tsx exactly
    const svgString = `
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="logo-gradient" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#c084fc" />
            <stop offset="50%" stop-color="#818cf8" />
            <stop offset="100%" stop-color="#22d3ee" />
          </linearGradient>
        </defs>
        <path d="M14 12V36" stroke="url(#logo-gradient)" stroke-width="5" stroke-linecap="round" />
        <path d="M14 16H24C29.5228 16 34 20.4772 34 26C34 31.5228 29.5228 36 24 36H14" stroke="url(#logo-gradient)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.4" />
        <path d="M26 29L34 36" stroke="url(#logo-gradient)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="34" cy="36" r="3" fill="#22d3ee" />
      </svg>
    `.trim();

    // 2. Convert string to a Blob and URL
    const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);

    // 3. Find and update the favicon link tag
    let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.getElementsByTagName("head")[0].appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = url;

    // Cleanup
    return () => URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  /* ---------------- Auth & Data Listener ---------------- */

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        const savedTheme = await getUserTheme(currentUser.uid);
        if (savedTheme) setTheme(savedTheme);
        
        try {
          const pagesFromDB = await getAllPages(currentUser.uid);
          setPages(pagesFromDB);
        } catch (err) {
          console.error("Error loading pages:", err);
          setError("Failed to load pages.");
        }
      } else {
        setUser(null);
        setPages([]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  /* ---------------- Page Management ---------------- */

  const addPage = async (type: PageDef["type"], name: string) => {
    if (!user) return;

    const id = Date.now();
    const slug = name.trim().toLowerCase().replace(/\s+/g, "-");

    const newPage: PageDef = {
      id,
      name,
      type,
      path: `/user/${user.uid}/${type}/${id}/${slug}`,
    };

    try {
      await addPageToDB(user.uid, newPage);
      setPages((prev) => [...prev, newPage]);
    } catch (err) {
      console.error("Error adding page:", err);
      setError("Failed to add page.");
    }
  };

  const deletePage = async (id: number) => {
    if (!user) return;

    try {
      await deletePageAndComponents(user.uid, id);
      setPages((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Error deleting page:", err);
      setError("Failed to delete page.");
    }
  };

  if (loading) {
    return (
        <div className="min-h-screen bg-black flex items-center justify-center text-white">
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="animate-pulse font-medium tracking-widest uppercase text-xs">Loading Revsy</div>
            </div>
        </div>
    );
  }

  const headerProps = {
    theme,
    setTheme,
    user,
    setUser,
    setIsauth,
    isPaneOpen,
    setIsPaneOpen,
    setError,
    pages
  };

  return (
    <BrowserRouter>
        {/* --- GLOBAL BACKGROUND --- */}
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none select-none">
            <div className="absolute inset-0 opacity-[0.03] bg-grid-black dark:bg-grid-white" />
            <div className="blob-base blob-purple"></div>
            <div className="blob-base blob-cyan"></div>
            <div className="blob-base blob-pink"></div>
            <div className="absolute inset-0 bg-gradient-to-t from-transparent via-transparent to-white/10 dark:to-black/20" />
        </div>

        <div className="app-bg relative z-10 min-h-screen transition-colors duration-500">
            
            {error && (
                <Alert message={error} type="error" onClose={() => setError(null)} />
            )}
            {alert && (
                <Alert message={alert} type="alert" onClose={() => setAlert(null)} />
            )}

            {isauth && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100]"
                    onClick={() => {
                        setIsauth(false);
                        closeModal();
                    }}
                >
                    <div onClick={(e) => e.stopPropagation()}>
                        <AuthModal
                            theme={theme}
                            isauth={isauth}
                            setIsauth={setIsauth}
                            setUser={setUser}
                        />
                    </div>
                </div>
            )}

            <Routes>
                <Route
                    path="/"
                    element={
                        user ? (
                            <Navigate to={`/user/${user.uid}`} replace />
                        ) : (
                            <>
                                <HeaderBar {...headerProps} />
                                <MainPage
                                    pages={pages}
                                    addPage={addPage}
                                    theme={theme}
                                    deletePage={deletePage}
                                    error={error}
                                    setError={setError}
                                    user={user}
                                    alert={alert}
                                    setAlert={setAlert}
                                />
                            </>
                        )
                    }
                />

                <Route
                    path={`/user/${user ? user.uid : ""}`}
                    element={
                        <>
                            <HeaderBar {...headerProps} />
                            <MainPage
                                pages={pages}
                                addPage={addPage}
                                theme={theme}
                                deletePage={deletePage}
                                error={error}
                                setError={setError}
                                user={user}
                                alert={alert}
                                setAlert={setAlert}
                            />
                        </>
                    }
                />

                {pages.map((p) => (
                    <Route
                        key={p.id}
                        path={p.path}
                        element={
                            <>
                                <HeaderBar {...headerProps} />
                                <div className="min-h-screen">
                                    {p.type === "problem" ? (
                                        <ProblemsPage
                                            theme={theme}
                                            pageId={p.id}
                                            user={user}
                                            setError={setError}
                                            name={p.name}
                                        />
                                    ) : (
                                        <ConceptsPage
                                            theme={theme}
                                            pageId={p.id}
                                            user={user}
                                            setError={setError}
                                            name={p.name}
                                        />
                                    )}
                                </div>
                            </>
                        }
                    />
                ))}

                <Route
                    path="/view/:type/:userId/:pageId"
                    element={
                        <PublicRouteWrapper
                            theme={theme}
                            setTheme={setTheme}
                        />
                    }
                />

                <Route
                    path="/error"
                    element={
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                            <div className="absolute inset-0 z-0 bg-white/20 dark:bg-black/60 backdrop-blur-[100px]" />
                            <div className="relative z-10 w-full max-w-md">
                                <div className="glass-panel p-10 rounded-[3rem] text-center shadow-2xl relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-red-500 via-orange-500 to-red-500" />
                                    <div className="mb-8 flex justify-center">
                                        <div className="w-24 h-24 rounded-3xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 shadow-xl">
                                            <span className="material-icons text-6xl">lock</span>
                                        </div>
                                    </div>
                                    <h2 className="text-3xl font-black mb-4 text-gray-900 dark:text-white tracking-tight">Content Private</h2>
                                    <p className="text-gray-500 dark:text-gray-400 mb-10 leading-relaxed font-medium">This page has been set to private by the owner. Please contact them directly to request a viewing link.</p>
                                    <div className="flex flex-col gap-3">
                                        <a href="/" className="btn-gradient w-full py-4 rounded-2xl shadow-lg block font-bold text-lg hover:scale-[1.02] transition-all">Return to Dashboard</a>
                                        <button onClick={() => window.history.back()} className="w-full py-3 text-sm font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">Go Back</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    }
                />

                <Route
                    path="*"
                    element={
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 overflow-hidden">
                            <div className="absolute inset-0 z-0 bg-white/20 dark:bg-black/60 backdrop-blur-[100px]" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[140px] animate-pulse" />
                            <div className="relative z-10 w-full max-w-lg">
                                <h1 className="text-[12rem] md:text-[16rem] font-black text-black/5 dark:text-white/5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 select-none pointer-events-none z-0">404</h1>
                                <div className="glass-panel p-12 rounded-[3.5rem] text-center shadow-[0_32px_64px_rgba(0,0,0,0.4)] border-white/20 dark:border-white/10 relative overflow-hidden group z-10">
                                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500" />
                                    <div className="mb-10 flex justify-center">
                                        <div className="w-24 h-24 rounded-[2rem] bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 shadow-2xl transition-all duration-700">
                                            <span className="material-icons text-6xl">explore_off</span>
                                        </div>
                                    </div>
                                    <h2 className="text-4xl font-black mb-4 text-gray-900 dark:text-white tracking-tighter">Lost in the Void?</h2>
                                    <p className="text-gray-500 dark:text-neutral-400 mb-12 leading-relaxed font-medium text-lg">The coordinates you entered don't exist. The page might have been moved or dissolved into digital stardust.</p>
                                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                        <a href="/" className="btn-gradient px-10 py-4 rounded-2xl shadow-xl flex items-center justify-center font-bold text-lg hover:scale-[1.03] transition-all whitespace-nowrap">Take Me Home</a>
                                        <button onClick={() => window.history.back()} className="px-10 py-4 rounded-2xl font-bold border border-gray-200 dark:border-white/5 bg-white/5 dark:bg-black/20 text-gray-600 dark:text-gray-300 hover:bg-white/10 transition-all whitespace-nowrap">Go Back</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    }
                />
            </Routes>
      </div>
    </BrowserRouter>
  );
}

const PublicRouteWrapper = ({
  theme,
  setTheme,
}: {
  theme: "dark" | "light";
  setTheme: React.Dispatch<React.SetStateAction<"dark" | "light">>;
}) => {
  const { type, userId, pageId } = useParams();

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  if (!type || !userId || !pageId) {
    return (
        <div className="min-h-screen flex items-center justify-center p-6">
            <div className="glass-panel p-10 rounded-3xl text-center">
                <span className="material-icons text-5xl text-red-500 mb-4">link_off</span>
                <div className="text-xl font-bold">Invalid URL</div>
            </div>
        </div>
    );
  }

  return (
    <div className="min-h-screen transition-colors duration-500">
        {type === "problem" ? (
            <PublicProblemsPage
                theme={theme}
                setTheme={setTheme}
                userId={userId}
                pageId={Number(pageId)}
            />
        ) : (
            <PublicConceptsPage
                theme={theme}
                setTheme={setTheme}
                userId={userId}
                pageId={Number(pageId)}
            />
        )}
    </div>
  );
};

export default App;