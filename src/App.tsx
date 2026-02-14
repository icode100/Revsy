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

  /* ---------------- Auth Listener ---------------- */

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setTheme(await getUserTheme(currentUser.uid));
        try {
          const pagesFromDB = await getAllPages(currentUser.uid);
          setPages(pagesFromDB);
        } catch (err) {
          console.error(err);
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

  /* ---------------- Page Actions ---------------- */

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
      console.error(err);
      setError("Failed to add page.");
    }
  };

  const deletePage = async (id: number) => {
    if (!user) return;

    try {
      await deletePageAndComponents(user.uid, id);
      setPages((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error(err);
      setError("Failed to delete page.");
    }
  };

  if (loading) {
    return <div className="text-center mt-20">Loading...</div>;
  }

  return (
    <BrowserRouter>
      {error && (
        <Alert message={error} type="error" onClose={() => setError(null)} />
      )}
      {alert && (
        <Alert message={alert} type="alert" onClose={() => setAlert(null)} />
      )}

      {isauth && (
        <div
          className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => {
            setIsauth(false);
            closeModal();
          }}
        >
          <AuthModal
            theme={theme}
            isauth={isauth}
            setIsauth={setIsauth}
            setUser={setUser}
          />
        </div>
      )}

      <Routes>

        {/* Home */}
        <Route
          path="/"
          element={
            user ? (
              <Navigate to={`/user/${user.uid}`} replace />
            ) : (
              <>
                <HeaderBar
                  theme={theme}
                  setTheme={setTheme}
                  user={user}
                  setUser={setUser}
                  setIsauth={setIsauth}
                  isPaneOpen={isPaneOpen}
                  setIsPaneOpen={setIsPaneOpen}
                  setError={setError}
                  pages={pages}
                />
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

        {/* Dashboard */}
        <Route
          path={`/user/${user ? user.uid : ""}`}
          element={
            <>
              <HeaderBar
                theme={theme}
                setTheme={setTheme}
                user={user}
                setUser={setUser}
                setIsauth={setIsauth}
                isPaneOpen={isPaneOpen}
                setIsPaneOpen={setIsPaneOpen}
                setError={setError}
                pages={pages}
              />
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

        {/* Private Pages */}
        {pages.map((p) => (
          <Route
            key={p.id}
            path={p.path}
            element={
              <>
                <HeaderBar
                  theme={theme}
                  setTheme={setTheme}
                  user={user}
                  setUser={setUser}
                  setIsauth={setIsauth}
                  isPaneOpen={isPaneOpen}
                  setIsPaneOpen={setIsPaneOpen}
                  setError={setError}
                  pages={pages}
                />
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
              </>
            }
          />
        ))}

        {/* ✅ PUBLIC STATIC ROUTE */}
        <Route
          path="/view/:type/:userId/:pageId"
          element={
            <PublicRouteWrapper
              theme={theme}
              setTheme={setTheme}
            />
          }
        />

        {/* 404 */}
        <Route
          path="*"
          element={
            <div
              className={`min-h-screen p-4 ${
                theme === "dark"
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-black"
              }`}
            >
              <div className="mt-40 text-center text-3xl">
                <h1 className="text-4xl font-bold">404 - Page Not Found</h1>
                <p className="mt-4">
                  The page you are looking for does not exist.
                </p>
                <a href="/" className="underline mt-6 inline-block">
                  Go to Home
                </a>
              </div>
            </div>
          }
        />

        {/* Unauthorized */}
        <Route
          path="/error"
          element={
            <div
              className={`min-h-screen p-4 ${
                theme === "dark"
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-black"
              }`}
            >
              <div className="mt-40 text-center text-3xl">
                <h1 className="text-4xl font-bold">
                  Unauthorized Access
                </h1>
                <p className="mt-4 text-red-400">
                  The page is not public.
                </p>
              </div>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

/* -------- Public Wrapper -------- */

const PublicRouteWrapper = ({
  theme,
  setTheme,
}: {
  theme: "dark" | "light";
  setTheme: React.Dispatch<React.SetStateAction<"dark" | "light">>;
}) => {
  const { type, userId, pageId } = useParams();

  if (!type || !userId || !pageId) {
    return <div>Invalid URL</div>;
  }

  return type === "problem" ? (
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
  );
};

export default App;
