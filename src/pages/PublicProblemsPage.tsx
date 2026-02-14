import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { throttle } from "lodash";

import PublicProblemComponent from "../components/PublicProblemComponent";
import { getComponentsOfPage } from "../services/firestore";
import { db } from "../services/firebase";
import type { ProblemComponentType } from "./ProblemsPage";
import { FirebaseError } from "firebase/app";


interface PublicProblemsPageProps {
  theme: "dark" | "light";
  setTheme: React.Dispatch<React.SetStateAction<"dark" | "light">>;
  userId: string | undefined;
  pageId: number;
}

const PublicProblemsPage: React.FC<PublicProblemsPageProps> = ({
  theme,
  setTheme,
  userId,
  pageId,
}) => {
  const [problemComponents, setProblemComponents] = useState<
    ProblemComponentType[]
  >([]);
  const [pageName, setPageName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isReversed, setIsReversed] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollUpButton, setShowScrollUpButton] = useState(false);

  const pageEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  /* ------------------ Scroll Handling ------------------ */

  const handleScroll = () => {
    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    setShowScrollButton(scrollTop + windowHeight < documentHeight - 100);
    setShowScrollUpButton(scrollTop > 100);
  };

  const throttledHandleScroll = useRef(throttle(handleScroll, 100)).current;

  const scrollToBottom = useCallback(() => {
    pageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* ------------------ Data Loading ------------------ */

  useEffect(() => {
    const loadPageData = async () => {
      if (!userId || !pageId) {
        setError("Invalid page.");
        return;
      }

      try {
        // Fetch page document
        const pageRef = doc(db, "users", userId, "pages", String(pageId));
        const snap = await getDoc(pageRef);

        if (!snap.exists()) {
          navigate("/error");
          return;
        }

        const data = snap.data();

        if (!data.isPublic) {
          navigate("/error");
          return;
        }

        setPageName(data.name);

        // Fetch components
        const components = await getComponentsOfPage(userId, pageId);
        setProblemComponents(components as ProblemComponentType[]);
      } catch (err: unknown) {
        console.error(err);

        if (err instanceof FirebaseError) {
          if (err.code === "permission-denied") {
            navigate("/error");
            return;
          }
        }

        setError("Failed to load page data.");
      }
    };

    loadPageData();

    window.addEventListener("scroll", throttledHandleScroll);
    return () => {
      window.removeEventListener("scroll", throttledHandleScroll);
    };
  }, [userId, pageId, navigate, throttledHandleScroll]);

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const toggleOrder = () => {
    setIsReversed((prev) => !prev);
  };

  /* ------------------ Render ------------------ */

  return (
    <div
      className={`min-h-screen p-4 ${theme === "dark"
        ? "bg-gray-900 text-white"
        : "bg-gray-100 text-black"
        }`}
    >
      {/* Scroll Buttons */}
      {showScrollUpButton && (
        <button
          className={`fixed bottom-16 right-4 px-4 py-2 rounded-full shadow-lg ${theme === "dark"
            ? "bg-green-600 hover:bg-green-700 text-white"
            : "bg-green-500 hover:bg-green-600 text-white"
            }`}
          onClick={scrollToTop}
          title="Scroll to top"
        >
          ↑
        </button>
      )}

      {showScrollButton && (
        <button
          className={`fixed bottom-4 right-4 px-4 py-2 rounded-full shadow-lg ${theme === "dark"
            ? "bg-blue-600 hover:bg-blue-700 text-white"
            : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          onClick={scrollToBottom}
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">
          Public Problem Page: {pageName}
        </h1>

        <div className="flex gap-3 items-center">
          <button
            className={`px-4 py-2 rounded-full ${theme === "dark"
              ? "bg-purple-600 hover:bg-purple-700"
              : "bg-purple-500 hover:bg-purple-600"
              } text-white`}
            onClick={toggleOrder}
            title={isReversed ? "Show oldest first" : "Show newest first"}
          >
            {isReversed ? "↓" : "↑"}
          </button>

          <button
            onClick={toggleTheme}
            className={`px-3 py-2 rounded-full ${theme === "dark"
              ? "bg-blue-500 hover:bg-blue-600"
              : "bg-blue-600 hover:bg-blue-700"
              } text-white`}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {/* Content */}
      {error ? (
        <div className="text-red-500 text-center">{error}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {(isReversed
            ? [...problemComponents].reverse()
            : problemComponents
          ).map((component) => (
            <PublicProblemComponent
              key={component.id}
              id={component.id}
              problems={component.problems}
              note={component.note}
              theme={theme}
            />
          ))}
        </div>
      )}

      <div ref={pageEndRef} />
    </div>
  );
};

export default PublicProblemsPage;
