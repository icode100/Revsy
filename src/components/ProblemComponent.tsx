// ProblemComponent.tsx
import React, { useState } from 'react';
import Accordion from '../components/Accordion';
import MarkdownEditor from '../components/MarkdownEditor';
import MarkdownRenderer from '../components/MarkdownRenderer';
import ProblemForm from '../components/ProblemForm';
import { useModal } from '../components/ModalContext';

interface Problem {
    id: number;
    title: string;
    description: string;
    url: string;
    isLeetCode: boolean;
}

interface ProblemComponentProps {
    theme: 'dark' | 'light';
    onDelete: () => void;
    editMode: boolean;
}

const ProblemComponent: React.FC<ProblemComponentProps> = ({ theme, editMode }) => {
    const [problems, setProblems] = useState<Problem[]>([]);
    const [note, setNote] = useState('Add your notes here');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { globalModalOpen, openModal, closeModal } = useModal();
    const addProblem = (problem: { title: string; description: string; url: string }) => {
        setProblems([
            ...problems,
            {
                id: Date.now(),
                title: problem.title,
                description: problem.description,
                url: problem.url,
                isLeetCode: problem.url.includes('leetcode.com'),
            },
        ]);
        setIsModalOpen(false);
        closeModal();
    };

    const updateProblem = (id: number, updatedProblem: Problem) => {
        setProblems(problems.map((problem) => (problem.id === id ? updatedProblem : problem)));
    };

    const deleteProblem = (id: number) => {
        setProblems(problems.filter((problem) => problem.id !== id));
    };


    return (
        <div>

            {/* Modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50"
                    onClick={() => {setIsModalOpen(false); closeModal();}}
                >
                    <div
                        className={`rounded-lg shadow-lg p-6 w-full max-w-lg max-h-screen overflow-y-auto ${theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-gray-50 text-black'
                            }`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="text-xl font-bold mb-4">Add New Problem</h2>
                        <ProblemForm onSubmit={addProblem} theme={theme} />
                        <button
                            className={`mt-4 px-4 py-2 rounded ${theme === 'dark' ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'
                                } text-white`}
                            onClick={() => { setIsModalOpen(false); closeModal(); }}
                        >
                            <span className="material-icons">close</span>
                        </button>
                    </div>
                </div>
            )}
            <div
                className={`p-4 mb-6 rounded-lg shadow-md ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-300 text-black'
                    } ${globalModalOpen ? "blur-2xl" : ""}`}
            >
                <div className="grid grid-cols-10 gap-3 px-4 py-4">
                    {/* problems column */}
                    <div className="col-span-5">
                        {
                            problems.length > 0 ? (
                                problems.map((problem) => (
                                    <div
                                        key={problem.id}
                                        className={`mb-4 p-4 rounded-lg shadow ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'
                                            }`}
                                    >
                                        {editMode ? (
                                            <>
                                                <label htmlFor={`title-${problem.id}`}>Title</label>
                                                <input
                                                    id={`title-${problem.id}`}
                                                    type="text"
                                                    value={problem.title}
                                                    onChange={(e) =>
                                                        updateProblem(problem.id, { ...problem, title: e.target.value })
                                                    }
                                                    className={`w-full px-2 py-1 rounded border ${theme === 'dark'
                                                        ? 'bg-gray-800 border-gray-600 text-white'
                                                        : 'bg-gray-100 border-gray-300 text-black'
                                                        }`}
                                                />
                                                <label htmlFor={`description-${problem.id}`}>Description</label>
                                                <textarea
                                                    id={`description-${problem.id}`}
                                                    value={problem.description}
                                                    onChange={(e) =>
                                                        updateProblem(problem.id, { ...problem, description: e.target.value })
                                                    }
                                                    className={`w-full mt-2 px-2 py-1 rounded border ${theme === 'dark'
                                                        ? 'bg-gray-800 border-gray-600 text-white'
                                                        : 'bg-gray-100 border-gray-300 text-black'
                                                        }`}
                                                />
                                                <label htmlFor={`url-${problem.id}`}>URL</label>
                                                <input
                                                    id={`url-${problem.id}`}
                                                    type="url"
                                                    value={problem.url}
                                                    onChange={(e) =>
                                                        updateProblem(problem.id, { ...problem, url: e.target.value })
                                                    }
                                                    className={`w-full mt-2 px-2 py-1 rounded border ${theme === 'dark'
                                                        ? 'bg-gray-800 border-gray-600 text-white'
                                                        : 'bg-gray-100 border-gray-300 text-black'
                                                        }`}
                                                />
                                                <button
                                                    className={`mt-2 px-4 py-2 rounded ${theme === 'dark' ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'
                                                        } text-white`}
                                                    onClick={() => deleteProblem(problem.id)}
                                                >
                                                    Delete Problem
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <Accordion
                                                    title={
                                                        <a
                                                            href={problem.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={`hover:underline ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
                                                                }`}
                                                        >
                                                            {problem.title}
                                                        </a>
                                                    }
                                                    description={problem.description}
                                                    theme={theme}
                                                />
                                            </>
                                        )}
                                    </div>
                                ))
                        ):(
                            <div className={`text-center ${theme==="dark"?"bg-gray-700":"bg-white"} py-3 rounded-lg`}>
                                Add your problems here
                            </div>
                        )
                        }

                    </div>
                    {/* notes column */}
                    <div className={`col-span-5 ${theme==="dark"?"bg-gray-700":"bg-white"} py-3 rounded-lg`}>
                        {/* Shared Note */}
                        <div className="place-items-center">
                            {editMode ? (
                                <MarkdownEditor value={note} onChange={setNote} theme={theme} />
                            ) : (
                                <div className="">
                                    <MarkdownRenderer content={note} theme={theme} />
                                </div>
                            )}
                        </div>
                    </div>                    
                </div>
                {/* add problem button */}
                {editMode && (
                    <div className="mt-4">
                        <button
                            className={`px-3 py-2 rounded-full ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-indigo-500 hover:bg-indigo-600'
                                } text-white`}
                            onClick={() => { setIsModalOpen(true); openModal(); }} title='add problems'
                        >
                            <span className="material-icons">note_add</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProblemComponent;
