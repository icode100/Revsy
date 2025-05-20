// /* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState } from 'react';
import Accordion from '../components/Accordion';
import MarkdownEditor from '../components/MarkdownEditor';
import ProblemForm from '../components/ProblemForm';

interface Problem {
    id: number;
    title: string;
    description: string;
    url: string;
    isLeetCode: boolean;
}

interface ProblemsPageProps {
    theme: "dark" | "light";
}

const ProblemsPage: React.FC<ProblemsPageProps> = ({ theme }) => {
    const [problems, setProblems] = useState<Problem[]>([]);
    const [notes, setNotes] = useState<{ [key: number]: string }>({});
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProblemId, setEditingProblemId] = useState<number | null>(null);

    const addNewProblem = (problem: { title: string; description: string; url: string }) => {
        setProblems([
            ...problems,
            {
                id: Date.now(),
                title: problem.title,
                description: problem.description,
                url: problem.url,
                isLeetCode: problem.url.includes("leetcode.com"),
            },
        ]);
        setIsModalOpen(false); // Close the modal after submission
    };

    const deleteProblem = (id: number) => {
        setProblems(problems.filter((problem) => problem.id !== id));
    };

    const handleNoteChange = (id: number, value: string) => {
        setNotes({ ...notes, [id]: value });
    };

    const handleEditProblem = (id: number) => {
        setEditingProblemId(id);
    };

    const handleSaveProblem = (id: number, updatedTitle: string, updatedDescription: string, updatedUrl: string) => {
        setProblems(
            problems.map((problem) =>
                problem.id === id
                    ? { ...problem, title: updatedTitle, description: updatedDescription, url: updatedUrl }
                    : problem
            )
        );
        setEditingProblemId(null); // Exit editing mode
    };

    return (
        <div
            className={`relative min-h-screen p-4 ${theme === "dark" ? "bg-gray-900 text-white" : "bg-gray-100 text-black"
                }`}
        >


            {/* Modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 bg-transparent bg-opacity-50 flex items-center justify-center z-50"
                    onClick={() => setIsModalOpen(false)} // Close modal when clicking outside
                >
                    <div
                        className={`${theme==="dark"?"bg-gray-700":"bg-gray-50"} rounded-lg shadow-lg p-6 w-full max-w-lg max-h-screen overflow-y-auto ${theme === "dark" ? "text-white" : "text-black"
                            }`}
                        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside the modal
                    >
                        <h2 className="text-xl font-bold mb-4">Add New Problem</h2>
                        <ProblemForm onSubmit={addNewProblem} theme={theme} />
                        <button
                            className={`mt-4 px-4 py-2 rounded ${theme === "dark"
                                ? "bg-red-600 text-white hover:bg-red-700"
                                : "bg-red-500 text-white hover:bg-red-600"
                                }`}
                            onClick={() => setIsModalOpen(false)}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}



            {/* Problems List */}
            <div className={`grid grid-cols-7 gap-2 ${isModalOpen ? "blur-2xl" : ""}`}>
                <div className="col-start-2 col-span-5">
                    {problems.map((problem) => (
                        <React.Fragment key={problem.id}>
                            <div
                                className={`grid grid-cols-7 gap-10 items-center ${theme === "dark" ? "bg-gray-700" : "bg-gray-50"
                                    } p-4 rounded-lg shadow-md mb-4`}
                            >
                                {/* First Column */}
                                <div className="col-span-3">
                                    {editingProblemId === problem.id ? (
                                        <>
                                            <label htmlFor="problem-title">Title</label>
                                            <input
                                                type="text"
                                                id='problem-title'
                                                value={problem.title}
                                                onChange={(e) =>
                                                    setProblems(
                                                        problems.map((p) =>
                                                            p.id === problem.id
                                                                ? { ...p, title: e.target.value }
                                                                : p
                                                        )
                                                    )
                                                }
                                                className={`w-full px-2 py-1 rounded border ${theme === "dark"
                                                    ? "bg-gray-800 border-gray-600 text-white"
                                                    : "bg-gray-100 border-gray-300 text-black"
                                                    }`}
                                            />
                                            <label htmlFor="problem-description">Problem description</label>
                                            <textarea
                                                id='problem-description'
                                                value={problem.description}
                                                onChange={(e) =>
                                                    setProblems(
                                                        problems.map((p) =>
                                                            p.id === problem.id
                                                                ? { ...p, description: e.target.value }
                                                                : p
                                                        )
                                                    )
                                                }
                                                className={`w-full mt-2 px-2 py-1 rounded border ${theme === "dark"
                                                    ? "bg-gray-800 border-gray-600 text-white"
                                                    : "bg-gray-100 border-gray-300 text-black"
                                                    }`}
                                            />
                                            <label htmlFor="problem-url">Problem URL</label>
                                            <input
                                                type="url"
                                                id='problem-url'
                                                value={problem.url}
                                                onChange={(e) =>
                                                    setProblems(
                                                        problems.map((p) =>
                                                            p.id === problem.id
                                                                ? { ...p, url: e.target.value }
                                                                : p
                                                        )
                                                    )
                                                }
                                                className={`w-full mt-2 px-2 py-1 rounded border ${theme === "dark"
                                                    ? "bg-gray-800 border-gray-600 text-white"
                                                    : "bg-gray-100 border-gray-300 text-black"
                                                    }`}
                                            />
                                            <button
                                                className={`mt-2 px-4 py-2 rounded ${theme === "dark"
                                                    ? "bg-green-600 text-white hover:bg-green-700"
                                                    : "bg-green-500 text-white hover:bg-green-600"
                                                    }`}
                                                onClick={() =>
                                                    handleSaveProblem(
                                                        problem.id,
                                                        problem.title,
                                                        problem.description,
                                                        problem.url
                                                    )
                                                }
                                            >
                                                Save
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
                                                        className={`${theme === "dark"
                                                            ? "text-blue-300"
                                                            : "text-blue-700"
                                                            } hover:underline`}
                                                    >
                                                        {problem.title}
                                                    </a>
                                                }
                                                description={problem.description}
                                                theme={theme}
                                            />
                                            <button
                                                className={`mt-3 px-4 py-3 rounded-full ${theme === "dark"
                                                    ? "bg-yellow-600 text-white hover:bg-yellow-700"
                                                    : "bg-yellow-500 text-white hover:bg-yellow-600"
                                                    }`}
                                                onClick={() => handleEditProblem(problem.id)}
                                            >
                                                <span className="material-icons">
                                                    edit
                                                </span>
                                            </button>
                                        </>
                                    )}
                                </div>

                                {/* Second Column */}
                                <div className="col-span-3">
                                    <MarkdownEditor
                                        value={notes[problem.id] || ""}
                                        onChange={(value) => handleNoteChange(problem.id, value)}
                                        theme={theme}
                                    />
                                </div>

                                {/* Third Column */}
                                <div className="col-span-1">
                                    <button
                                        className={`px-4 py-2 rounded ${theme === "dark"
                                            ? "bg-red-600 text-white hover:bg-red-700"
                                            : "bg-red-500 text-white hover:bg-red-600"
                                            }`}
                                        onClick={() => deleteProblem(problem.id)}
                                    >
                                        Delete
                                    </button>
                                </div>


                            </div>
                        </React.Fragment>
                    ))}
                    {/* Add New Problem Button */}
                    < div className="" >
                        <button
                            className={`px-4 py-2 rounded ${theme === "dark"
                                ? "bg-green-600 text-white hover:bg-green-700"
                                : "bg-green-500 text-white hover:bg-green-600"
                                } rounded-2xl`}
                            onClick={() => setIsModalOpen(true)}
                        >
                            Add New Problem
                        </button>
                    </div>
                </div>
            </div>
        </div >
    );
};

export default ProblemsPage;