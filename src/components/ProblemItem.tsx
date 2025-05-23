// ProblemItem.tsx
import React, { useState } from 'react';
import Accordion from './Accordion';

interface Problem {
  id: number;
  title: string;
  description: string;
  url: string;
  isLeetCode: boolean;
}

interface ProblemItemProps {
  problem: Problem;
  onUpdate: (updatedProblem: Problem) => void;
  onDelete: () => void;
  theme: 'dark' | 'light';
}

const ProblemItem: React.FC<ProblemItemProps> = ({ problem, onUpdate, onDelete, theme }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedProblem, setEditedProblem] = useState(problem);

  const handleSave = () => {
    onUpdate(editedProblem);
    setIsEditing(false);
  };

  return (
    <div className={`p-4 rounded shadow ${theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-black'}`}>
      {isEditing ? (
        <div className="space-y-2">
          <input
            type="text"
            value={editedProblem.title}
            onChange={e => setEditedProblem({ ...editedProblem, title: e.target.value })}
            className="w-full px-2 py-1 rounded border"
          />
          <textarea
            value={editedProblem.description}
            onChange={e => setEditedProblem({ ...editedProblem, description: e.target.value })}
            className="w-full px-2 py-1 rounded border"
          />
          <input
            type="url"
            value={editedProblem.url}
            onChange={e => setEditedProblem({ ...editedProblem, url: e.target.value })}
            className="w-full px-2 py-1 rounded border"
          />
          <div className="flex space-x-2">
            <button
              onClick={handleSave}
              className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-green-600 text-white' : 'bg-green-500 text-white'}`}
            >
              Save
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-gray-600 text-white' : 'bg-gray-500 text-white'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <Accordion
            title={
              <a href={problem.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                {problem.title}
              </a>
            }
            description={problem.description}
            theme={theme}
          />
          <div className="flex space-x-2 mt-2">
            <button
              onClick={() => setIsEditing(true)}
              className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-yellow-600 text-white' : 'bg-yellow-500 text-white'}`}
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-red-600 text-white' : 'bg-red-500 text-white'}`}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProblemItem;
