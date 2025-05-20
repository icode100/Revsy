// /* eslint-disable @typescript-eslint/no-unused-vars */
import { useState } from 'react'
import { BrowserRouter, Routes, Route } from "react-router";
// import ConceptsPage from './pages/ConceptsPage'
// import Navbar from './components/Navbar';
// import ProblemsPage from "./pages/ProblemsPage";
// import Accordion from "./components/Accordion";
// import MarkdownEditor from './components/MarkdownEditor';
// import ProblemForm from './components/ProblemForm';
import ConceptComponent from './components/ConceptComponent';

function App() {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <div className={`relative min-h-screen ${theme === "dark" ? "bg-gray-900" : "bg-gray-100"}`} >
                {/* Toggle Theme Button */}
                <div className="fixed top-4 left-4 z-50">
                  <button
                    onClick={() =>
                      setTheme((prev) => (prev === "light" ? "dark" : "light"))
                    }
                    className={`px-3 py-2 rounded-full ${theme === "dark"
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
                </div>

                {/* Problems Page */}
                {/* <ProblemsPage theme={theme} /> */}
                <ConceptComponent title="Example Concept Title" description='$x$ Description' theme = {theme}/>
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </>
  );
}

export default App;
