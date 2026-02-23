import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import Accordion from '../components/Accordion';
import MarkdownEditor from '../components/MarkdownEditor';
import MarkdownRenderer from '../components/MarkdownRenderer';
import ProblemForm from '../components/ProblemForm';
import ExpandModal from '../components/ExpandModal';
import { useModal } from '../components/ModalContext';

export interface Problem {
    id: number;
    title: string;
    description: string;
    url: string;
    isLeetCode: boolean;
    tagArr: string[];
}

interface ProblemComponentProps {
    id: string;
    problems: Problem[];
    note: string;
    theme: 'dark' | 'light';
    onProblemsChange: (id: string, value: Problem[]) => void;
    onNoteChange: (id: string, value: string) => void;
    onDelete: (id: string) => void;
    setError?: (error: string) => void;
}

const ProblemComponent: React.FC<ProblemComponentProps> = ({ id, problems, note, theme, onDelete, onNoteChange, onProblemsChange, setError }) => {
    // Standard Modals
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const { globalModalOpen, openModal, closeModal } = useModal();
    
    // Edit Mode State
    const [editMode, setEditMode] = useState(false);
    const [editedProblems, setProblems] = useState<Problem[]>(problems);
    const [editedNote, setNote] = useState<string>(note);

    // Expand Modal State (Generic for Problem OR Note)
    const [expandedContent, setExpandedContent] = useState<{ title: string; description: string; tagArr: string[] } | null>(null);

    const addProblem = (problem: Problem) => {
        setProblems([
            ...editedProblems,
            {
                id: Date.now(),
                title: problem.title,
                description: problem.description,
                url: problem.url,
                isLeetCode: problem.url.includes('leetcode.com'),
                tagArr: problem.tagArr || [],
            },
        ]);
        setIsAddModalOpen(false);
        closeModal();
    };

    const updateProblem = (id: number, updatedProblem: Problem) => {
        setProblems(editedProblems.map((problem) => (problem.id === id ? updatedProblem : problem)));
    };

    const deleteProblem = (id: number) => {
        setProblems(editedProblems.filter((problem) => problem.id !== id));
    };

    const splitAndStrip = (tags: string) => {
        const tag_arr: string[] = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        const tagArr: string[] = tag_arr.length > 3 ? tag_arr.slice(0, 3) : tag_arr;
        return tagArr;
    };

    const handleSave = () => {
        onProblemsChange(id, editedProblems);
        onNoteChange(id, editedNote);
        setEditMode(false);
    };

    // Generic handler to open ExpandModal
    const handleExpandProblem = (problem: Problem) => {
        setExpandedContent({
            title: problem.title,
            description: problem.description,
            tagArr: problem.tagArr
        });
        openModal();
    };

    const handleExpandNote = () => {
        setExpandedContent({
            title: "Concept Notes",
            description: note,
            tagArr: []
        });
        openModal();
    };

    const handleCloseExpand = () => {
        setExpandedContent(null);
        closeModal();
    };

    const formRef = useRef<HTMLDivElement>(null);
    
    // Close modal on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isAddModalOpen && formRef.current && !formRef.current.contains(event.target as Node)) {
                setIsAddModalOpen(false);
                closeModal();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeModal, isAddModalOpen]);

    return (
        <>
            {/* --- Add Problem Modal (Portaled) --- */}
            {isAddModalOpen && ReactDOM.createPortal(
                <div className="modal-overlay">
                    <div className="modal-glass" onClick={(e) => e.stopPropagation()} ref={formRef}>
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add New Problem</h2>
                            <button
                                className="btn-glass-action"
                                onClick={() => { setIsAddModalOpen(false); closeModal(); }}
                            >
                                <span className="material-icons">close</span>
                            </button>
                        </div>
                        <ProblemForm onSubmit={addProblem} theme={theme} />
                    </div>
                </div>,
                document.body
            )}

            {/* --- Expand Modal (Handles its own portal) --- */}
            <ExpandModal 
                isOpen={!!expandedContent}
                onClose={handleCloseExpand}
                title={expandedContent?.title || ''}
                description={expandedContent?.description || ''}
                tagArr={expandedContent?.tagArr || []}
                theme={theme}
            />

            {/* --- Main Component --- */}
            <div className={`problem-component-wrapper ${globalModalOpen ? "blur-md" : ""}`}>
                
                {/* --- Header / Actions Toolbar --- */}
                <div className="absolute top-6 right-8 flex items-center gap-2 z-20">
                    {editMode ? (
                         <button
                            className="btn-glass-action btn-action-save"
                            onClick={handleSave}
                            title="Save Changes"
                        >
                            <span className="material-icons">check</span>
                            <span className="ml-2 font-medium">Save</span>
                        </button>
                    ) : (
                        <button
                            className="btn-glass-action btn-action-edit"
                            onClick={() => setEditMode(!editMode)}
                            title="Edit Page"
                        >
                            <span className="material-icons">edit</span>
                        </button>
                    )}
                    
                    <button
                        className="btn-glass-action btn-action-delete"
                        onClick={() => onDelete(id)}
                        title="Delete Page"
                    >
                        <span className="material-icons">delete</span>
                    </button>
                </div>


                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-2 items-start">
                    
                    {/* --- Left Column: Problems List --- */}
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-lg font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                Problems
                            </h3>
                            {/* Add Problem Button (Only visible in edit mode) */}
                            {editMode && (
                                <button
                                    className="px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 bg-blue-50 text-sm font-medium hover:bg-blue-100 dark:border-blue-900 dark:text-blue-300 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 transition-colors flex items-center gap-1"
                                    onClick={() => { setIsAddModalOpen(true); openModal(); }} 
                                >
                                    <span className="material-icons text-sm">add</span>
                                    Add Problem
                                </button>
                            )}
                        </div>

                        {editedProblems.length > 0 ? (
                            <div className="flex flex-col gap-4">
                                {editedProblems.map((problem) => (
                                    <div key={problem.id} className="transition-all">
                                        {editMode ? (
                                            <div className="glass-panel p-5 rounded-xl space-y-4 border-l-4 border-blue-500">
                                                <div>
                                                    <label htmlFor={`title-${problem.id}`} className="label-text">Title</label>
                                                    <input
                                                        id={`title-${problem.id}`}
                                                        type="text"
                                                        value={problem.title}
                                                        onChange={(e) => updateProblem(problem.id, { ...problem, title: e.target.value })}
                                                        className="input-field"
                                                    />
                                                </div>
                                                
                                                <div>
                                                    <label htmlFor={`description-${problem.id}`} className="label-text">Description</label>
                                                    <textarea
                                                        id={`description-${problem.id}`}
                                                        value={problem.description}
                                                        onChange={(e) => updateProblem(problem.id, { ...problem, description: e.target.value })}
                                                        className="input-field min-h-[80px]"
                                                    />
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label htmlFor={`tags-${problem.id}`} className="label-text">Tags (comma sep)</label>
                                                        <input
                                                            type="text"
                                                            id={`tags-${problem.id}`}
                                                            value={problem.tagArr.join(',')}
                                                            onChange={(e) => updateProblem(problem.id, { ...problem, tagArr: e.target.value.split(',') })}
                                                            onBlur={(e) => updateProblem(problem.id, { ...problem, tagArr: splitAndStrip(e.target.value) })}
                                                            className="input-field"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label htmlFor={`url-${problem.id}`} className="label-text">URL</label>
                                                        <input
                                                            id={`url-${problem.id}`}
                                                            type="url"
                                                            value={problem.url}
                                                            onChange={(e) => updateProblem(problem.id, { ...problem, url: e.target.value })}
                                                            className="input-field"
                                                        />
                                                    </div>
                                                </div>

                                                <button
                                                    className="w-full py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20 transition-all flex items-center justify-center gap-2 text-sm font-medium"
                                                    onClick={() => deleteProblem(problem.id)}
                                                >
                                                    <span className="material-icons text-sm">delete</span>
                                                    Remove Problem
                                                </button>
                                            </div>
                                        ) : (
                                            <Accordion
                                                url={problem.url}
                                                title={
                                                    <span className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                        {problem.title}
                                                    </span>
                                                }
                                                description={problem.description}
                                                tagArr={problem.tagArr}
                                                theme={theme}
                                                setError={setError ?? (() => {})}
                                                onExpand={() => handleExpandProblem(problem)}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="glass-panel p-8 text-center rounded-2xl border-dashed border-2 border-gray-300 dark:border-gray-700">
                                <p className="text-gray-500 dark:text-gray-400">No problems added yet.</p>
                                {editMode && <p className="text-sm text-gray-400 mt-2">Click "Add Problem" to get started.</p>}
                            </div>
                        )}
                    </div>

                    {/* --- Right Column: Notes --- */}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-lg font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                Concept Notes
                            </h3>
                        </div>
                        
                        {/* Removed h-full here to prevent stretching empty space */}
                        <div>
                            {editMode ? (
                                <MarkdownEditor
                                    value={editedNote}
                                    onChange={setNote}
                                    theme={theme}
                                />
                            ) : (
                                // Removed h-full from this panel to allow it to shrink to fit content
                                <div className="glass-panel rounded-2xl overflow-hidden flex flex-col">
                                    <div className="notes-scroll-box custom-scrollbar flex-grow">
                                        <MarkdownRenderer content={note} theme={theme} />
                                    </div>
                                    <div className="accordion-actions">
                                         <button 
                                            className="btn-expand w-full justify-center"
                                            onClick={handleExpandNote}
                                        >
                                            <span className="material-icons text-xs">open_in_full</span>
                                            Expand Notes
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default ProblemComponent;