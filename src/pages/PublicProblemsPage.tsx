import React, { useCallback, useEffect, useRef, useState } from 'react';
import PublicProblemComponent from "../components/PublicProblemComponent";
import { isPagePublic, getComponentsOfPage } from '../services/firestore';
import type { ProblemComponentType } from './ProblemsPage';
import { useNavigate } from 'react-router-dom';
import { throttle } from 'lodash';

interface PublicProblemsPageProps {
  theme: 'dark' | 'light';
  setTheme: React.Dispatch<React.SetStateAction<'dark' | 'light'>>;
  userId: string | undefined; // Optional userId prop for future use
  name: string;
  pageId: number;
}

const PublicProblemsPage: React.FC<PublicProblemsPageProps> = ({ theme, setTheme, userId, name, pageId }) => {
  const [problemComponents, setProblemComponents] = useState<ProblemComponentType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isReversed, setIsReversed] = useState(false); // State to track the order of components
  const [showScrollButton, setShowScrollButton] = useState(false); // State for scroll button visibility
  const [showScrollUpButton, setShowScrollUpButton] = useState(false); // State for scroll-to-top button visibility
  const pageEndRef = useRef<HTMLDivElement>(null); // Ref for the end of the page
  const navigate = useNavigate();
  const toggleOrder = () => {
    setIsReversed(prev => !prev); // Toggle the order
  };
  const handleScroll = () => {
    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    const shouldShowScrollButton = scrollTop + windowHeight < documentHeight - 100;
    const shouldShowScrollUpButton = scrollTop > 100;

    if (showScrollButton !== shouldShowScrollButton) {
      setShowScrollButton(shouldShowScrollButton);
    }
    if (showScrollUpButton !== shouldShowScrollUpButton) {
      setShowScrollUpButton(shouldShowScrollUpButton);
    }
  };
  const throttledHandleScroll = useRef(throttle(handleScroll, 100)).current;


  const scrollToBottom = useCallback(() => {
    pageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const loadPageData = async () => {
      if (!pageId) {
        setError("Invalid page ID.");
        return;
      }

      try {
        const isPublic = await isPagePublic(userId ? userId : "", Number(pageId)); // Check if the page is public
        if (!isPublic) {
          setError("This page is not public.");
          navigate('/error'); // Redirect to home if not public
          return;
        }

        const components = await getComponentsOfPage(userId ? userId : "", Number(pageId)) as ProblemComponentType[];
        setProblemComponents(components);
      } catch (err) {
        console.error(err);
        setError("Failed to load page data.");
      }
    };

    loadPageData();
    window.addEventListener('scroll', throttledHandleScroll);
    return () => {
      window.removeEventListener('scroll', throttledHandleScroll);
    };
  }, [pageId, navigate, userId, throttledHandleScroll]);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <div className={`min-h-screen p-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'}`}>
      {/* Header */}

      {/* Scroll-to-bottom button */}
      {showScrollUpButton && (
        <button
          className={`fixed bottom-16 right-4 px-4 py-2 rounded-full shadow-lg ${theme === 'dark' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-500 hover:bg-green-600 text-white'}`}
          onClick={scrollToTop}
          title="Scroll to top"
        >
          ↑
        </button>
      )}
      {showScrollButton && (
        <button
          className={`fixed bottom-4 right-4 px-4 py-2 rounded-full shadow-lg ${theme === 'dark' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
          onClick={scrollToBottom}
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Public Problem Page: {name}</h1>
        {/* Toggle Order Button */}

        <button
          className={`fixed right-20 px-4 py-2 rounded-full ${theme === 'dark' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-purple-500 hover:bg-purple-600'} text-white`}
          onClick={toggleOrder}
          title={isReversed ? "Show oldest first" : "Show newest first"}
        >
          {isReversed ? (<span className='material-icons'>keyboard_double_arrow_down</span>) : (<span className='material-icons'>keyboard_double_arrow_up</span>)}
        </button>
        <button
          onClick={toggleTheme}
          className={`px-3 py-2 rounded-full ${theme === 'dark' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
        >
          <span className="material-icons">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>
      </div>

      {error ? (
        <div className="text-red-500 text-center">{error}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {(isReversed ? [...problemComponents].reverse() : problemComponents).map((component) => (
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
    </div>
  );
};

export default PublicProblemsPage;