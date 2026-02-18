import React from 'react';
import ReactDOM from 'react-dom';
import MarkdownRenderer from './MarkdownRenderer';

interface ExpandModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    description: string;
    tagArr: string[];
    theme: 'dark' | 'light';
}

const ExpandModal: React.FC<ExpandModalProps> = ({ isOpen, onClose, title, description, tagArr, theme }) => {
    if (!isOpen) return null;

    // Helper: Determine badge style (Reused logic for consistency)
    const getBadgeStyle = (tag: string) => {
        const t = tag.toLowerCase();
        if (t === 'hard') return 'badge-red';
        if (t === 'medium') return 'badge-yellow';
        if (t === 'easy') return 'badge-green';
        if (t === 'heap') return 'badge-maroon';
        if (['dp', 'graph', 'tree'].includes(t)) return 'badge-blue';
        return 'badge-gray';
    };

    // Use createPortal to render the modal outside the blurred app container
    return ReactDOM.createPortal(
        <div className="modal-overlay z-[110]">
            <div className="modal-glass max-w-4xl w-[90vw] h-[85vh] flex flex-col p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                
                {/* Fixed Header */}
                <div className="p-6 border-b border-gray-200/50 dark:border-white/10 bg-white/50 dark:bg-black/20 backdrop-blur-md shrink-0 flex justify-between items-start">
                    <div>
                        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-3">
                            {title}
                        </h2>
                        <div className="flex flex-wrap gap-2">
                            {tagArr.map((tag, index) => (
                                <span key={index} className={`badge ${getBadgeStyle(tag)}`}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>
                    <button 
                        className="btn-icon-glass hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        onClick={onClose}
                    >
                        <span className="material-icons">close</span>
                    </button>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-grow overflow-y-auto p-6 custom-scrollbar">
                    <MarkdownRenderer content={description} theme={theme} />
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ExpandModal;