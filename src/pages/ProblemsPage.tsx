/* eslint-disable @typescript-eslint/ban-ts-comment */
import React, { useEffect, useState, useRef, useCallback } from 'react';
const ProblemComponent = React.lazy(() => import('../components/ProblemComponent'));
import { type Problem } from '../components/ProblemComponent';
import { useModal } from '../components/ModalContext';
import type { signInWithEmail, signOut } from '../services/firebaseAuth';
import { parseExcelFileProblems } from '../services/excelParser';
import { addComponentToPage, deleteComponent, getComponentsOfPage, updateComponent } from '../services/firestore';
import { fetchLeetCodeProblem } from '../services/leetcode';
import { throttle } from 'lodash'

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;
interface ProblemsPageProps {
  theme: 'dark' | 'light';
  pageId: number
  user: User | null | nulluser;
  setError?: (error: string) => void; // Optional error handler
  name: string;

}

export interface ProblemComponentType {
  id: string;
  problems: Problem[];
  note: string;
  // ComponentType: string;
}

const ProblemsPage: React.FC<ProblemsPageProps> = ({ theme, pageId, user, setError, name }) => {
  const [problemComponents, setProblemComponents] = useState<ProblemComponentType[]>([]);
  const { globalModalOpen, openModal, closeModal } = useModal();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false); // State for scroll button visibility
  const [showScrollUpButton, setShowScrollUpButton] = useState(false); // State for scroll-to-top button visibility
  const pageEndRef = useRef<HTMLDivElement>(null); // Ref for the end of the page


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


  // useEffect(() => {

  // }, []);

  const handleSubmitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadedFile || !sheetName) {
      setError?.("Please upload a file and provide a sheet name.");
      return;
    }
    try {
      setLoading(true);
      const parsedData = await parseExcelFileProblems(uploadedFile, sheetName);
      console.log("Parsed Data:", parsedData);
      if (parsedData.length === 0) {
        setError?.("No valid data found in the uploaded file.");
        return;
      }
      // new components
      const newComponents = await Promise.all(parsedData.map(async (data) => (
        {
          problems: await Promise.all(data.problems.map(async (problem, index) => {
            const match = problem.url.match(/^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/?(description\/?)?$/);
            if (match) {
              const temp = await fetchLeetCodeProblem(problem.url);
              return {
                id: Number(`${Date.now()}${index}`), // Generate a unique ID for each problem
                title: problem.title,
                description: temp?.description || '',
                url: problem.url || '',
                isLeetCode: problem.url.includes('leetcode.com'),
                tagArr: ['normal', 'leetcode'],
              } as Problem;
            } else {
              return {
                id: Number(`${Date.now()}${index}`), // Generate a unique ID for each problem
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
        problems: p.problems as Problem[], // Assuming problems is an array of Problem type
        note: p.note,
      }));
      setProblemComponents(transformed);
    };

    loadProblemComponents();

    window.addEventListener('scroll', debouncedHandleScroll);
    return () => {
      window.removeEventListener('scroll', debouncedHandleScroll);
    };
  }, [user, pageId, debouncedHandleScroll

  ]);

  const handleAddProblemComponent = async () => {
    if (!user || !pageId) return;
    const newComponent = {
      problems: [],
      note: 'Edit your notes here',
      componentType: 'problem',
    };
    const docRef = await addComponentToPage(user.uid, pageId, newComponent);
    setProblemComponents(prev => [...prev, { ...newComponent, id: docRef.id }]); // OR include doc ID
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
      <div
        className={`min-h-screen p-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'
          } ${problemComponents.length === 0 ? "place-items-center" : ""}`}
      >
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
        {isModalOpen && (
          <form className={`mt-25 p-6 rounded-lg shadow-md ${theme === "dark" ? "bg-gray-800 text-white" : "bg-white text-black"
            }`} onSubmit={handleSubmitForm}>
            <div className="mb-4">
              <label htmlFor="sheet-name-id">sheet name</label>
              <input required={true} className={`w-full px-4 py-2 rounded border ${theme === "dark"
                ? "bg-gray-700 border-gray-600 text-white hover:bg-gray-800"
                : "bg-gray-100 border-gray-300 text-black hover:bg-gray-200"
                }`} type="text" id='sheet-name-id' placeholder='type the sheet name here' value={sheetName} onChange={(event) => setSheetName(event?.target.value)} />
            </div>
            <div className="mb-4">
              <label htmlFor="sheet-input" className={`w-full text-blue-500 hover:underline cursor-pointer`}>
                Upload your file <span className="material-icons">upload_file</span>
              </label>
              <input required={true} className="hidden" type="file" id='sheet-input' onChange={(event) => { const file = event.target.files?.[0]; setUploadedFile(file || null) }} />
              {uploadedFile && (<p className={`mt-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Uploaded File: {uploadedFile.name}</p>)}
            </div>
            <div className="mb-4 py-3 px-3">
              <button className='mx-2 bg-red-700 hover:bg-red-800 text-white rounded' onClick={() => { setIsModalOpen(!isModalOpen); closeModal(); }}><span className="material-icons">close</span></button>
              <button disabled={loading} className={`mx-2 rounded ${loading
                ? "bg-gray-400 cursor-not-allowed"
                : theme === "dark"
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-green-500 hover:bg-green-600 text-white"
                }`} type='submit'><span className="material-icons">arrow_right_alt</span></button>
            </div>
          </form>
        )}

        {
          problemComponents.length > 0 ? (
            <div className="grid grid-cols-7 gap-2 mt-30">
              <div className="col-start-2 col-span-5">
                <h1 className='text-4xl bold mb-4'>Problem Page: {name}</h1>
                <h4> The number of problem components being {problemComponents.length}</h4>
                {problemComponents.map((component) => (
                  <div className='mb-4' key={component.id}>
                    <React.Suspense fallback={<div>Loading...</div>}>
                      <ProblemComponent
                        key={component.id}
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
                  </div>
                ))}
                <div className="mt-4">
                  <button
                    className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
                      } text-white ${globalModalOpen ? "blur-2xl" : ""}`}
                    onClick={handleAddProblemComponent}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className={`mt-50 place-items-center text-5xl bold ${globalModalOpen ? "blur-2xl" : ""}`}>
              <div className="grid grid-cols-3 gap-10">
                <button
                  className={`${theme === 'dark' ? ' text-white hover:underline' : 'text-gray-900 hover:underline'
                    } ${globalModalOpen ? "blur-2xl" : ""}`}
                  onClick={handleAddProblemComponent} title='add concept'
                >Add</button>
                <span>|</span>
                <div className={`${theme === 'dark' ? ' text-white hover:underline' : 'text-gray-900 hover:underline'
                  } `}>
                  <button className={`${theme === 'dark' ? ' text-white hover:underline' : 'text-gray-900 hover:underline'
                    }`} onClick={() => { setIsModalOpen(!isModalOpen); openModal(); }}>Upload</button>
                </div>
              </div>
            </div>
          )
        }
        <div ref={pageEndRef}></div> {/* Reference for the end of the page */}

      </div>
    </>
  );
};

export default ProblemsPage;