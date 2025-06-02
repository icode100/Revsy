import React, { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import MarkdownEditor from './MarkdownEditor';

interface ConceptComponentProps {
  id: string;
  title: string;
  description?: string;
  theme?: 'dark' | 'light';
  onDelete: (id: string) => void;
  onTitleChange: (id: string, newTitle: string) => void;
  onDescriptionChange: (id: string, newDescription: string) => void;
}

const ConceptComponent: React.FC<ConceptComponentProps> = ({
  id,
  title,
  description = '',
  theme = 'light',
  onDelete,
  onTitleChange,
  onDescriptionChange,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const [editedDescription, setEditedDescription] = useState(description);

  const handleSave = () => {
    onTitleChange(id, editedTitle);
    onDescriptionChange(id, editedDescription);
    setIsEditing(false);
  };

  const handleEdit = () => {
    setEditedTitle(title);
    setEditedDescription(description);
    setIsEditing(true);
  };

  return (
    <div
      className={`p-4 rounded-lg shadow-md ${
        theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-black'
      }`}
    >
      <div className="grid grid-cols-3 gap-2">
        <div></div>
        <div
          className={`col-start-1 col-span-3 ${
            theme === 'dark' ? 'bg-gray-900' : 'bg-gray-300'
          } rounded-lg px-2 py-4`}
        >
          <div className="grid grid-cols-9 gap-3">
            {/* Title Section */}
            <div
              className={`col-span-4 text-center text-xl font-bold rounded-lg ${
                theme === 'dark' ? 'text-white bg-gray-700' : 'text-gray-800 bg-white'
              }`}
            >
              {isEditing ? (
                <textarea
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className={`w-full h-full rounded px-2 py-2${
                    theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-white text-black'
                  }`}
                  placeholder='Enter your title here'
                />
              ) : (
                <div className="h-full place-content-center">
                  <MarkdownRenderer content={title} theme={theme}/>
                </div>
              )}
            </div>

            {/* Description Section */}
            <div className="col-span-4">
              {isEditing ? (
                <MarkdownEditor
                  value={editedDescription}
                  onChange={setEditedDescription}
                  theme={theme}
                />
              ) : (
                <div
                  className={`${
                    theme === 'dark' ? 'bg-gray-700' : 'bg-white'
                  } rounded-lg px-2 py-2 h-full place-content-center`}
                >
                  <MarkdownRenderer content={description} theme={theme} />
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="col-span-1 text-center flex flex-col gap-2">
              {isEditing ? (
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                >
                  <span className='material-icons'>save</span>
                </button>
              ) : (
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  <span className="material-icons">edit</span>
                </button>
              )}
              <button
                onClick={() => onDelete(id)}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                <span className="material-icons">delete</span>
              </button>
            </div>
          </div>
        </div>
        <div></div>
      </div>
    </div>
  );
};

export default ConceptComponent;
