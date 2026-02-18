/* eslint-disable @typescript-eslint/ban-ts-comment */
import React, { useEffect, useState, useRef, useCallback } from 'react';
const ProblemComponent = React.lazy(() => import('../components/ProblemComponent'));
import { type Problem } from '../components/ProblemComponent';
import { useModal } from '../components/ModalContext';
import { parseExcelFileProblems } from '../services/excelParser';
import { addComponentToPage, deleteComponent, getComponentsOfPage, updateComponent } from '../services/firestore';
import { fetchLeetCodeProblem } from '../services/leetcode';
import { throttle } from 'lodash'
import type { User } from "firebase/auth";

interface ProblemsPageProps {
  theme: 'dark' | 'light';
  pageId: number
  user: User | null;
  setError?: (error: string) => void;
  name: string;
}

export interface ProblemComponentType {
  id: string;
  problems: Problem[];
  note: string;
}

const ProblemsPage: React.FC<ProblemsPageProps> = ({ theme, pageId, user, setError, name }) => {
  const [problemComponents, setProblemComponents] = useState<ProblemComponentType[]>([]);
  const [isReversed, setIsReversed] = useState(false);
  const { globalModalOpen, openModal, closeModal } = useModal();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollUpButton, setShowScrollUpButton] = useState(false);
  
  const pageEndRef = useRef<HTMLDivElement>(null);
  
  // NEW: Ref for the header title animation
  const headerRef = useRef<HTMLDivElement>(null);

  const toggleOrder = () => {
    setIsReversed(prev => !prev);
  };

  // NEW: Optimized scroll handler for Animation
  useEffect(() => {
    const handleVisualScroll = () => {
      if (!headerRef.current) return;
      const scrollY = window.scrollY;
      
      // Calculate opacity: starts fading immediately, gone by 300px
      const opacity = Math.max(0, 1 - scrollY / 300);
      
      // Calculate scale: starts at 1, shrinks to 0.8
      const scale = Math.max(0.8, 1 - scrollY / 1000);
      
      // Calculate translateY: moves up slightly to avoid collision
      const translateY = Math.min(50, scrollY / 2);

      // Apply styles directly for performance (avoids React re-renders)
      headerRef.current.style.opacity = opacity.toString();
      headerRef.current.style.transform = `scale(${scale}) translateY(-${translateY}px)`;
      
      // If fully invisible, set visibility to hidden to prevent interaction blocking
      headerRef.current.style.visibility = opacity <= 0 ? 'hidden' : 'visible';
    };

    window.addEventListener('scroll', handleVisualScroll);
    return () => window.removeEventListener('scroll', handleVisualScroll);
  }, []);

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

  const debouncedHandleScroll = useRef(throttle(handleScroll, 100)).current;

  const scrollToBottom = useCallback(() => {
    pageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSubmitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadedFile || !sheetName) {
      setError?.("Please upload a file and provide a sheet name.");
      return;
    }
    try {
      setLoading(true);
      const parsedData = await parseExcelFileProblems(uploadedFile, sheetName);
      if (parsedData.length === 0) {
        setError?.("No valid data found in the uploaded file.");
        return;
      }
      
      const newComponents = await Promise.all(parsedData.map(async (data) => (
        {
          problems: await Promise.all(data.problems.map(async (problem, index) => {
            const match = problem.url.match(/^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/?(description\/?)?$/);
            if (match) {
              const temp = await fetchLeetCodeProblem(problem.url);
              return {
                id: Number(`${Date.now()}${index}`),
                title: problem.title,
                description: temp?.description || '',
                url: problem.url || '',
                isLeetCode: problem.url.includes('leetcode.com'),
                tagArr: ['normal', 'leetcode'],
              } as Problem;
            } else {
              return {
                id: Number(`${Date.now()}${index}`),
                title: problem.title,
                description: '',
                url: problem.url || '',
                isLeetCode: problem.url.includes('leetcode.com'),
                tagArr: ['normal', 'leetcode'],
              } as Problem;
            }

          })),
          note: data.note || 'Edit your notes here',
          componentType: 'problem',
        }
      )));

      const docRefs = await Promise.all(
        newComponents.map((component) => addComponentToPage(user?.uid || '', pageId, component))
      );
      const transformedComponents: ProblemComponentType[] = docRefs.map((docRef, index) => ({
        id: docRef.id,
        problems: newComponents[index].problems,
        note: newComponents[index].note,
      } as ProblemComponentType));

      setProblemComponents((prev) => [...prev, ...transformedComponents]);
      setIsModalOpen(false);
      setUploadedFile(null);
      setSheetName('');
      setLoading(false);
      closeModal();
    } catch (error) {
      console.error("Error parsing file:", error);
      setError?.("Failed to parse the uploaded file. Please check the format and try again.");
    }
  };

  useEffect(() => {
    const loadProblemComponents = async () => {
      if (!user || !pageId) return;
      // @ts-expect-error
      const components: ProblemComponentType[] = await getComponentsOfPage(user.uid, pageId) as Promise<ProblemComponentType[]>;
      const transformed = components.map(p => ({
        id: p.id,
        problems: p.problems as Problem[],
        note: p.note,
      }));
      setProblemComponents(transformed);
    };

    loadProblemComponents();

    window.addEventListener('scroll', debouncedHandleScroll);
    return () => {
      window.removeEventListener('scroll', debouncedHandleScroll);
    };
  }, [user, pageId, debouncedHandleScroll]);

  const handleAddProblemComponent = async () => {
    if (!user || !pageId) return;
    const newComponent = {
      problems: [],
      note: 'Edit your notes here',
      componentType: 'problem',
    };
    const docRef = await addComponentToPage(user.uid, pageId, newComponent);
    setProblemComponents(prev => [...prev, { ...newComponent, id: docRef.id }]);
  };

  const handleDeleteProblemComponent = async (id: string) => {
    if (!user || !pageId) return;
    await deleteComponent(user.uid, pageId, String(id));
    setProblemComponents(prev => prev.filter(c => c.id !== id));
  };

  const updateProblemField = async (id: string, value: Problem[]) => {
    if (!user || !pageId) return;
    setProblemComponents(prev =>
      prev.map(c => c.id === id ? { ...c, problems: value } : c)
    );
    const field = 'problems';
    await updateComponent(user.uid, pageId, String(id), { [field]: value });
  };

  const updateNoteField = async (id: string, value: string) => {
    if (!user || !pageId) return;
    setProblemComponents(prev =>
      prev.map(c => c.id === id ? { ...c, note: value } : c)
    );
    const field = 'note';
    await updateComponent(user.uid, pageId, String(id), { [field]: value });
  };

  return (
    <>
      <div className="page-container">
        
        {/* --- Floating Action Buttons (Top Right) --- */}
        <div className="fixed top-24 right-6 z-40 flex flex-col gap-3">
          <button
            className="fab-glass"
            onClick={toggleOrder}
            title={isReversed ? "Show oldest first" : "Show newest first"}
          >
            {isReversed ? (
              <span className='material-icons'>keyboard_double_arrow_down</span>
            ) : (
              <span className='material-icons'>keyboard_double_arrow_up</span>
            )}
          </button>
        </div>

        {/* --- Floating Scroll Buttons (Bottom Right) --- */}
        <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3">
          {showScrollUpButton && (
            <button
              className="fab-glass fab-primary"
              onClick={scrollToTop}
              title="Scroll to top"
            >
              <span className="material-icons">arrow_upward</span>
            </button>
          )}
          {showScrollButton && (
            <button
              className="fab-glass fab-primary"
              onClick={scrollToBottom}
              title="Scroll to bottom"
            >
              <span className="material-icons">arrow_downward</span>
            </button>
          )}
        </div>

        {/* --- Page Header with Animation --- */}
        {/* This container has fixed height to preserve layout flow while title vanishes */}
        <div className="relative mb-16 text-center h-[120px] flex items-center justify-center pointer-events-none">
            {/* The animated content wrapper */}
            <div 
                ref={headerRef}
                className="w-full flex flex-col items-center justify-center origin-center transition-transform duration-75 ease-out"
            >
                {/* Glow Effect Behind Title */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px]" />
                
                <h1 className="text-page-title relative z-10">{name}</h1>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/5 backdrop-blur-md text-xs font-medium text-gray-500 dark:text-gray-400 relative z-10">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    {problemComponents.length} {problemComponents.length === 1 ? 'Component' : 'Components'}
                </div>
            </div>
        </div>

        {/* --- File Upload Modal --- */}
        {isModalOpen && (
          <div className="modal-overlay">
             <form className="modal-glass" onSubmit={handleSubmitForm}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">Import Problems</h3>
                    <button 
                        type="button" 
                        className="btn-icon-glass"
                        onClick={() => { setIsModalOpen(false); closeModal(); }}
                    >
                        <span className="material-icons">close</span>
                    </button>
                </div>

                <div className="space-y-6">
                    <div>
                        <label htmlFor="sheet-name-id" className="label-text">Sheet Name</label>
                        <input 
                            required 
                            id='sheet-name-id'
                            type="text" 
                            className="input-field" 
                            placeholder='e.g., Sheet1' 
                            value={sheetName} 
                            onChange={(event) => setSheetName(event?.target.value)} 
                        />
                    </div>

                    <div>
                        <label className="label-text mb-2">Upload Excel File</label>
                        <label htmlFor="sheet-input" className="upload-zone block">
                            <span className="material-icons text-4xl text-blue-500 mb-2">upload_file</span>
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                                {uploadedFile ? uploadedFile.name : "Click to select file"}
                            </p>
                            <input 
                                required 
                                className="hidden" 
                                type="file" 
                                id='sheet-input' 
                                accept=".xlsx, .xls"
                                onChange={(event) => { const file = event.target.files?.[0]; setUploadedFile(file || null) }} 
                            />
                        </label>
                    </div>

                    <button 
                        disabled={loading} 
                        className="btn-submit flex items-center justify-center gap-2" 
                        type='submit'
                    >
                        {loading ? "Importing..." : "Import Data"}
                        {!loading && <span className="material-icons">arrow_forward</span>}
                    </button>
                </div>
            </form>
          </div>
        )}

        {/* --- Main Content Area --- */}
        {problemComponents.length > 0 ? (
            <div className={`max-w-5xl mx-auto space-y-8 ${globalModalOpen ? "blur-md" : ""}`}>
              {(isReversed ? [...problemComponents].reverse() : problemComponents).map((component) => (
                <React.Suspense fallback={<div className="glass-panel p-8 text-center">Loading...</div>} key={component.id}>
                  <ProblemComponent
                    id={component.id}
                    problems={component.problems as Problem[]}
                    note={component.note}
                    onDelete={handleDeleteProblemComponent}
                    onNoteChange={updateNoteField}
                    onProblemsChange={updateProblemField}
                    theme={theme}
                    setError={setError}
                  />
                </React.Suspense>
              ))}

              {/* Add Button at Bottom of List */}
              <div className="pt-4">
                 <button
                    className="btn-add-floating"
                    onClick={handleAddProblemComponent}
                  >
                    <span className="material-icons">add_circle</span>
                    <span>Add New Component</span>
                  </button>
              </div>
            </div>
        ) : (
            /* --- Empty State --- */
            <div className={`min-h-[50vh] flex flex-col items-center justify-center ${globalModalOpen ? "blur-md" : ""}`}>
                <div className="glass-panel p-10 rounded-3xl text-center max-w-lg mx-auto">
                    <div className="mb-6 flex justify-center">
                        <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                            <span className="material-icons text-4xl">inventory_2</span>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">Start Building</h2>
                    <p className="text-gray-500 dark:text-gray-400 mb-8">
                        Add a new problem set manually or import from an Excel sheet.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <button
                            className="btn-secondary"
                            onClick={handleAddProblemComponent} 
                            title='Add new concept'
                        >
                            <span className="material-icons text-blue-500">add</span>
                            Create New
                        </button>
                        
                        <button 
                            className="btn-secondary" 
                            onClick={() => { setIsModalOpen(true); openModal(); }}
                        >
                            <span className="material-icons text-purple-500">upload_file</span>
                            Import Excel
                        </button>
                    </div>
                </div>
            </div>
        )}
        
        <div ref={pageEndRef}></div>
      </div>
    </>
  );
};

export default ProblemsPage;