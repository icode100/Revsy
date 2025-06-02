/* eslint-disable @typescript-eslint/ban-ts-comment */
import React, { useEffect, useState } from 'react';
import ProblemComponent, { type Problem } from '../components/ProblemComponent';
import { useModal } from '../components/ModalContext';
import type { signInWithEmail, signOut } from '../services/firebaseAuth';
import { addComponentToPage, deleteComponent, getComponentsOfPage, updateComponent } from '../services/firestore';

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;
interface ProblemsPageProps {
  theme: 'dark' | 'light';
  pageId: number
  user: User | null | nulluser;
}

export interface ProblemComponentType {
  id: string;
  problems: Problem[];
  note: string;
  // ComponentType: string;
}

const ProblemsPage: React.FC<ProblemsPageProps> = ({ theme, pageId, user }) => {
  const [problemComponents, setProblemComponents] = useState<ProblemComponentType[]>([]);
  const { globalModalOpen } = useModal();

  useEffect(() => {
    const loadProblemComponents = async () => {
      if (!user || !pageId) return;
      // @ts-expect-error
      const components:ProblemComponentType[] = await getComponentsOfPage(user.uid, pageId) as Promise<ProblemComponentType[]>;
      const transformed = components.map(p => ({
        id: p.id,
        problems: p.problems as Problem[], // Assuming problems is an array of Problem type
        note: p.note,
      }));
      setProblemComponents(transformed);
    };

    loadProblemComponents();
  }, [user, pageId]);

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

  const handleDeleteProblemComponent = async (id:string) => {
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
    await updateComponent(user.uid, pageId, String(id), { [field]: value  });
  };

  const updateNoteField = async (id: string, value: string) => {
    if (!user || !pageId) return;
    setProblemComponents(prev =>
      prev.map(c => c.id === id ? { ...c, note: value } : c)
    );
    const field = 'note';
    await updateComponent(user.uid, pageId, String(id), {[field]: value  });
  };



  return (
    <div
      className={`min-h-screen p-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'
        } ${problemComponents.length === 0 ? "place-items-center" : ""}`}
    >

      {
        problemComponents.length > 0 ? (
          <div className="grid grid-cols-7 gap-2 mt-30">
            <div className="col-start-2 col-span-5">
              {problemComponents.map((component) => (
                <div className='mb-4' key={component.id}>
                  <ProblemComponent
                    key={component.id}
                    id={component.id}
                    problems={component.problems as Problem[]}
                    note={component.note}
                    onDelete={handleDeleteProblemComponent}
                    onNoteChange={updateNoteField}
                    onProblemsChange={updateProblemField}
                    theme={theme}
                  />
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
          <div className=' mt-20 place-items-center text-9xl bold'>
            <div className="">
              <button
                className={`px-100 py-90 rounded-full ${theme === 'dark' ? ' text-white border-2 border-solid-black hover:border-dotted' : 'text-gray-900 border-2 border-solid-black hover:border-dotted'
                  } ${globalModalOpen ? "blur-2xl" : ""}`}
                onClick={handleAddProblemComponent} title='add problem component'
              >
                +
              </button>
            </div>
          </div>

        )
      }
    </div>
  );
};

export default ProblemsPage;