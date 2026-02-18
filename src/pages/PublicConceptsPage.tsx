import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate} from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { throttle } from "lodash";

import { db } from "../services/firebase";
import { getComponentsOfPage } from "../services/firestore";
import PublicConceptComponent from "../components/PublicConceptComponent";
import type { Concept } from "./ConceptsPage";

interface PublicConceptsPageProps {
  theme: "dark" | "light";
  setTheme: React.Dispatch<React.SetStateAction<"dark" | "light">>;
  userId: string | undefined;
  pageId: number;
}

const PublicConceptsPage: React.FC<PublicConceptsPageProps> = ({
  theme,
  setTheme,
  userId,
  pageId,
}) => {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [pageName, setPageName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isReversed, setIsReversed] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollUpButton, setShowScrollUpButton] = useState(false);

  const pageEndRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  /* ---------------- Scroll Animations ---------------- */

  useEffect(() => {
    const handleVisualScroll = () => {
      if (!headerRef.current) return;
      const scrollY = window.scrollY;
      const opacity = Math.max(0, 1 - scrollY / 300);
      const scale = Math.max(0.8, 1 - scrollY / 1000);
      const translateY = Math.min(50, scrollY / 2);

      headerRef.current.style.opacity = opacity.toString();
      headerRef.current.style.transform = `scale(${scale}) translateY(-${translateY}px)`;
      headerRef.current.style.visibility = opacity <= 0 ? 'hidden' : 'visible';
    };

    window.addEventListener('scroll', handleVisualScroll);
    return () => window.removeEventListener('scroll', handleVisualScroll);
  }, []);

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

  /* ---------------- Data Loading ---------------- */

  useEffect(() => {
    const loadConcepts = async () => {
      if (!userId || !pageId) {
        setError("Invalid page.");
        return;
      }

      try {
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
        const components = await getComponentsOfPage(userId, pageId);
        const transformed: Concept[] = (components as Concept[]).map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description,
        }));

        setConcepts(transformed);
      } catch (err) {
        console.error(err);
        setError("Failed to load page data.");
      }
    };

    loadConcepts();
    window.addEventListener("scroll", throttledHandleScroll);
    return () => window.removeEventListener("scroll", throttledHandleScroll);
  }, [userId, pageId, navigate, throttledHandleScroll]);

  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light");
  const toggleOrder = () => setIsReversed((prev) => !prev);

  return (
    <div className="page-container">
      
      {/* --- Floating Action Buttons --- */}
      <div className="fixed top-24 right-6 z-40 flex flex-col gap-3">
        <button
          className="fab-glass"
          onClick={toggleOrder}
          title={isReversed ? "Show oldest first" : "Show newest first"}
        >
          <span className="material-icons">{isReversed ? 'keyboard_double_arrow_down' : 'keyboard_double_arrow_up'}</span>
        </button>
        <button
          onClick={toggleTheme}
          className="fab-glass"
          title="Toggle Theme"
        >
          <span className="material-icons">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
        </button>
      </div>

      <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3">
        {showScrollUpButton && (
          <button className="fab-glass fab-primary" onClick={scrollToTop}>
            <span className="material-icons">arrow_upward</span>
          </button>
        )}
        {showScrollButton && (
          <button className="fab-glass fab-primary" onClick={scrollToBottom}>
            <span className="material-icons">arrow_downward</span>
          </button>
        )}
      </div>

      {/* --- Page Header with Animation --- */}
      <div className="relative mb-16 text-center h-[120px] flex items-center justify-center pointer-events-none">
        <div ref={headerRef} className="w-full flex flex-col items-center justify-center origin-center transition-transform duration-75 ease-out">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-[80px]" />
            <h1 className="text-page-title relative z-10">{pageName}</h1>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/5 backdrop-blur-md text-xs font-medium text-gray-500 dark:text-gray-400 relative z-10">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                Public View • {concepts.length} Concepts
            </div>
        </div>
      </div>

      {/* --- Content Area --- */}
      <div className="max-w-4xl mx-auto">
        {error ? (
          <div className="glass-panel p-8 text-red-500 text-center rounded-2xl">{error}</div>
        ) : (
          <div className="flex flex-col gap-6">
            {(isReversed ? [...concepts].reverse() : concepts).map((concept) => (
              <PublicConceptComponent
                key={concept.id}
                id={concept.id}
                title={concept.title}
                description={concept.description}
                theme={theme}
              />
            ))}
          </div>
        )}
      </div>

      <div ref={pageEndRef} />
    </div>
  );
};

export default PublicConceptsPage;