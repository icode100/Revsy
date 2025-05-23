// ProblemGroup.tsx
import React, { useState } from 'react';
import ProblemItem from './ProblemItem';
import ProblemForm from './ProblemForm';
import MarkdownEditor from './MarkdownEditor';

interface Problem {
  id: number;
  title: string;
  description: string;
  url: string;
  isLeetCode: boolean;
}

interface ProblemGroupProps {
  theme: 'dark' | 'light';
  initialProblems?: Problem[];
  initialNote?: string;
}

const ProblemGroup: React.FC<ProblemGroupProps> = ({ theme, initialProblems = [], initialNote = '' }) => {
  const [problems, setProblems] = useState<Problem[]>(initialProblems);
  const [note, setNote] = useState<string>(initialNote);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const addProblem = (problem: Omit<Problem, 'id' | 'isLeetCode'>) => {
    const newProblem: Problem = {
      ...problem,
      id: Date.now(),
      isLeetCode: problem.url.includes('leetcode.com'),
    };
    setProblems([...problems, newProblem]);
    setIsModalOpen(false);
  };

  const updateProblem = (updatedProblem: Problem) => {
    setProblems(problems.map(p => (p.id === updatedProblem.id ? updatedProblem : p)));
  };

  const deleteProblem = (id: number) => {
    setProblems(problems.filter(p => p.id !== id));
  };

  return (
    <div className="mb-8">
      {/* Shared Note */}
      <div className="mb-4">
        <MarkdownEditor value={note} onChange={setNote} theme={theme} />
      </div>

      {/* Problems List */}
      <div className="space-y-4">
        {problems.map(problem => (
          <ProblemItem
            key={problem.id}
            problem={problem}
            onUpdate={updateProblem}
            onDelete={() => deleteProblem(problem.id)}
            theme={theme}
          />
        ))}
      </div>

      {/* Add Problem Button */}
      <div className="mt-4">
        <button
          onClick={() => setIsModalOpen(true)}
          className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-green-600 text-white' : 'bg-green-500 text-white'}`}
        >
          Add Problem
        </button>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className={`bg-white dark:bg-gray-800 p-6 rounded shadow-lg w-full max-w-md`}
            onClick={e => e.stopPropagation()}
          >
            <ProblemForm onSubmit={addProblem} theme={theme} />
            <button
              onClick={() => setIsModalOpen(false)}
              className={`mt-4 px-4 py-2 rounded ${theme === 'dark' ? 'bg-red-600 text-white' : 'bg-red-500 text-white'}`}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProblemGroup;
