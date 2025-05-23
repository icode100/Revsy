// ProblemsPage.tsx
import React, { useState } from 'react';
import ProblemComponent from '../components/ProblemComponent';
import { useModal } from '../components/ModalContext';
interface ProblemsPageProps {
  theme: 'dark' | 'light';
}

const ProblemsPage: React.FC<ProblemsPageProps> = ({ theme }) => {
  const [problemComponents, setProblemComponents] = useState<number[]>([]);
  const [editModeMap, setEditModeMap] = useState<Record<number, boolean>>({});
  const { globalModalOpen } = useModal();

  const addProblemComponent = () => {
    const id = Date.now();
    setProblemComponents([...problemComponents, id]);
    setEditModeMap({ ...editModeMap, [id]: false });
  };

  const deleteProblemComponent = (id: number) => {
    setProblemComponents(problemComponents.filter((componentId) => componentId !== id));
    const updatedEditModeMap = { ...editModeMap };
    delete updatedEditModeMap[id];
    setEditModeMap(updatedEditModeMap);
  };

  const toggleEditMode = (id: number) => {
    setEditModeMap({ ...editModeMap, [id]: !editModeMap[id] });
  };

  return (
    <div
      className={`min-h-screen p-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'
        } ${problemComponents.length === 0 ? "place-items-center" : ""}`}
    >

      {
        problemComponents.length > 0 ? (
          <div className="grid grid-cols-7 gap-2 mt-21">
            <div className="col-start-2 col-span-5">
              {problemComponents.map((id) => (
                <div key={id} className="mb-4">
                  <div className="grid grid-cols-19 gap-3 mb-2">
                    <button
                      className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'
                        } text-white ${globalModalOpen ? "blur-2xl" : ""}`}
                      onClick={() => toggleEditMode(id)}
                    >
                      {editModeMap[id] ? (<span className='material-icons'>save</span>) : (<span className="material-icons">edit</span>)}
                    </button>
                    <button
                      className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'
                        } text-white ${globalModalOpen ? "blur-2xl" : ""}`}
                      onClick={() => deleteProblemComponent(id)}
                    >
                      <span className="material-icons">delete</span>
                    </button>

                  </div>
                  <ProblemComponent
                    theme={theme}
                    onDelete={() => deleteProblemComponent(id)}
                    editMode={editModeMap[id] || false}
                  />
                </div>
              ))}
              <div className="mt-4">
                <button
                  className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
                    } text-white ${globalModalOpen ? "blur-2xl" : ""}`}
                  onClick={addProblemComponent}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className=' mt-10 place-items-center text-9xl bold'>
            <div className="">
              <button
                className={`px-100 py-90 rounded-full ${theme === 'dark' ? ' text-white border-2 border-solid-black hover:border-dotted' : 'text-gray-900 border-2 border-solid-black hover:border-dotted' 
                  } ${globalModalOpen ? "blur-2xl" : ""}`}
                onClick={addProblemComponent} title='add problem component'
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

