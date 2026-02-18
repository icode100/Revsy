import React, { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import MarkdownEditor from './MarkdownEditor';
import ExpandModal from './ExpandModal';
import { useModal } from './ModalContext';

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
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { openModal, closeModal } = useModal();

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

  const handleExpand = () => {
    setIsExpanded(true);
    openModal();
  };

  const handleCloseExpand = () => {
    setIsExpanded(false);
    closeModal();
  };

  return (
    <>
      <div className="glass-panel rounded-2xl p-6 mb-6 relative transition-all duration-300 hover:shadow-2xl">
        
        {/* --- Header & Actions --- */}
        <div className="flex justify-between items-start mb-4 gap-4">
          <div className="flex-grow">
            {isEditing ? (
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="input-field text-xl font-bold bg-white/50 dark:bg-black/20"
                placeholder="Enter concept title"
                autoFocus
              />
            ) : (
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white break-words">
                {title}
              </h2>
            )}
          </div>

          <div className="flex gap-2 shrink-0">
            {isEditing ? (
              <button
                onClick={handleSave}
                className="btn-glass-action btn-action-save"
                title="Save Changes"
              >
                <span className='material-icons'>check</span>
              </button>
            ) : (
              <button
                onClick={handleEdit}
                className="btn-glass-action btn-action-edit"
                title="Edit Concept"
              >
                <span className="material-icons">edit</span>
              </button>
            )}
            <button
              onClick={() => onDelete(id)}
              className="btn-glass-action btn-action-delete"
              title="Delete Concept"
            >
              <span className="material-icons">delete</span>
            </button>
          </div>
        </div>

        {/* --- Content Area --- */}
        <div className="rounded-xl overflow-hidden bg-white/30 dark:bg-black/20 border border-gray-200/50 dark:border-white/5">
          {isEditing ? (
            <div className="h-[350px]">
              <MarkdownEditor
                value={editedDescription}
                onChange={setEditedDescription}
                theme={theme}
              />
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Scrollable Description Box */}
              <div className="notes-scroll-box custom-scrollbar">
                <MarkdownRenderer content={description} theme={theme} />
              </div>
              
              {/* Footer Actions */}
              <div className="accordion-actions">
                <button 
                  className="btn-expand w-full justify-center"
                  onClick={handleExpand}
                >
                  <span className="material-icons text-xs">open_in_full</span>
                  Expand Concept
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- Expand Modal --- */}
      <ExpandModal
        isOpen={isExpanded}
        onClose={handleCloseExpand}
        title={title}
        description={description}
        tagArr={[]} // Concepts typically don't have the same tags array as problems
        theme={theme}
      />
    </>
  );
};

export default ConceptComponent;