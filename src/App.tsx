// /* eslint-disable @typescript-eslint/no-unused-vars */
import { useState } from 'react'
import { BrowserRouter, Routes, Route } from "react-router";
// import ConceptsPage from './pages/ConceptsPage'
// import Navbar from './components/Navbar';
import ProblemsPage from "./pages/ProblemsPage";
// import Accordion from "./components/Accordion";
// import MarkdownEditor from './components/MarkdownEditor';
// import ProblemForm from './components/ProblemForm';
// import ConceptComponent from './components/ConceptComponent';
// import ConceptsPage from './pages/ConceptsPage';
import AuthModal from './components/AuthModal';
import { useModal } from './components/ModalContext';

function App() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [auth, setAuth] = useState<boolean>(false);
  const {closeModal} = useModal();
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
                <div className={`relative min-h-screen w-full ${theme === "dark" ? "bg-gray-900" : "bg-gray-100"}`} >
                  {/* Toggle Button */}
                  <div className="fixed mt-4 w-full z-50">
                    <div className="grid grid-cols-41">
                      <div className="col-span-3"></div>
                      <button
                        onClick={() =>
                          setTheme((prev) => (prev === "light" ? "dark" : "light"))
                        }
                        className={`py-2 rounded-full ${theme === "dark"
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "bg-blue-500 text-white hover:bg-blue-600"
                          }`}
                      >

                        {theme === "dark" ? <span className="material-icons">
                          light_mode
                        </span> : <span className="material-icons">
                          dark_mode
                        </span>}
                      </button>
                      <div className="col-span-32"></div>
                      <button onClick={() =>
                        setAuth((prev) => (!prev))
                      } className={`rounded-full py-2 bg-orange-600 hover:bg-orange-700`}>
                        <span className="material-icons">person</span>
                      </button>

                    </div>
                  </div>
                  {
                    auth && (
                      <div
                        className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50"
                        onClick={() => { setAuth(false); closeModal(); }}
                      >
                        <AuthModal theme={theme} auth={auth} setAuth={setAuth} />
                      </div>
                    )
                  }

                  {/* Problems Page */}
                  <ProblemsPage theme={theme} />
                  {/* <ConceptsPage theme={theme} /> */}
                </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </>
  );
}

export default App;
