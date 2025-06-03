// ProblemComponent.tsx
import React, { useEffect, useRef, useState } from 'react';
import Accordion from '../components/Accordion';
import MarkdownEditor from '../components/MarkdownEditor';
import MarkdownRenderer from '../components/MarkdownRenderer';
import ProblemForm from '../components/ProblemForm';
import { useModal } from '../components/ModalContext';

export interface Problem {
    id: number;
    title: string;
    description: string;
    url: string;
    isLeetCode: boolean;
}

interface ProblemComponentProps {
  id: string;  // Changed from number to string
  problems: Problem[];
  note: string;
  theme: 'dark' | 'light';
  onProblemsChange: (id: string, value: Problem[]) => void;
  onNoteChange: (id: string, value: string) => void;
  onDelete: (id: string) => void;
}

const ProblemComponent: React.FC<ProblemComponentProps> = ({ id, problems, note, theme, onDelete, onNoteChange, onProblemsChange }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { globalModalOpen, openModal, closeModal } = useModal();
    const [editMode, setEditMode] = useState(false);
    const [editedProblems, setProblems] = useState<Problem[]>(problems);
    const [editedNote, setNote] = useState<string>(note);

    // functions to handle changes in problems
    const addProblem = (problem: Problem) => {
        setProblems([
            ...editedProblems,
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
        setProblems(editedProblems.map((problem) => (problem.id === id ? updatedProblem : problem)));
    };
    const deleteProblem = (id: number) => {
        setProblems(editedProblems.filter((problem) => problem.id !== id));
    };

    const handleSave = () => {
        onProblemsChange(id, editedProblems);
        onNoteChange(id, editedNote);
        setEditMode(false);
    };

    // Effect to handle click outside the modal to close it
    const formRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isModalOpen && formRef.current && !formRef.current.contains(event.target as Node)) {
                setIsModalOpen(false);
                closeModal();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeModal, isModalOpen, openModal]);

    return (
        <>

            {/* Modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50"
                >
                    <div
                        className={`rounded-lg shadow-lg p-6 w-full max-w-lg max-h-screen overflow-y-auto ${theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-gray-50 text-black'
                            }`}
                        onClick={(e) => e.stopPropagation()} ref={formRef}
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
                className={`p-4 rounded-lg shadow-md ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-black'
                    } ${globalModalOpen ? "blur-2xl" : ""}`}
            >

                <div className="grid grid-cols-3 gap-2">
                    <div></div>
                    <div
                        className={`col-start-1 col-span-3 ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-300'
                            } rounded-lg px-2 py-4`}
                    >
                        <div className="grid grid-cols-9 gap-3">
                            {/* problem section */}
                            <div
                                className={`col-span-4 p-4 rounded-lg ${theme === 'dark' ? 'text-white bg-gray-700' : 'text-gray-800 bg-white'
                                    }`}
                            >
                                <div className='grid grid-cols-1 '>
                                    <div>
                                        {
                                            editedProblems.length > 0 ? (
                                                editedProblems.map((problem) => (
                                                    <div
                                                        key={problem.id}
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
                                                            <div className='mb-4'>
                                                                <Accordion
                                                                    title={
                                                                        <a
                                                                            href={problem.url}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className={`hover:underline ${theme === 'dark' ? 'text-black' : 'text-white'
                                                                                }`}
                                                                        >
                                                                            {problem.title}
                                                                        </a>
                                                                    }
                                                                    description={problem.description}
                                                                    theme={theme}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                ))
                                            ) : (
                                                <div className={`text-center ${theme === "dark" ? "bg-gray-700" : "bg-white"} py-3 rounded-lg`}>
                                                    Add your problems here
                                                </div>
                                            )
                                        }
                                    </div>
                                    <div>
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
                            </div>

                            {/* notes section */}
                            <div className="col-span-4">
                                {editMode ? (
                                    <MarkdownEditor
                                        value={editedNote}
                                        onChange={setNote}
                                        theme={theme}
                                    />
                                ) : (
                                    <div
                                        className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-white'
                                            } rounded-lg px-2 py-2 h-full place-content-center`}
                                    >
                                        <MarkdownRenderer content={note} theme={theme} />
                                    </div>
                                )}
                            </div>

                            {/* Action Buttons */}
                            <div className="col-span-1 text-center flex flex-col gap-2">
                                {editMode ? (
                                    <button
                                        className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                                        onClick={handleSave}
                                    >
                                        <span className='material-icons'>save</span>
                                    </button>
                                ) : (
                                    <button
                                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                                        onClick={() => setEditMode(!editMode)}
                                    >
                                        <span className="material-icons">edit</span>
                                    </button>
                                )}
                                <button
                                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                                    onClick={() => onDelete(id)}
                                >
                                    <span className="material-icons">delete</span>
                                </button>
                            </div>


                        </div>
                    </div>
                    <div></div>
                </div>
            </div>
        </>

    );
};

export default ProblemComponent;