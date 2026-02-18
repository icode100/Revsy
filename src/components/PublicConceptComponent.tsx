import React, { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import ExpandModal from './ExpandModal';
import { useModal } from '../components/ModalContext';

interface PublicConceptComponentProps {
    id: string;
    title: string;
    description?: string;
    theme?: 'dark' | 'light';
}

const PublicConceptComponent: React.FC<PublicConceptComponentProps> = ({
    title,
    description = '',
    theme = 'light',
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const { openModal, closeModal } = useModal();

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
            <div className="glass-panel rounded-2xl p-6 relative transition-all duration-300 hover:shadow-2xl">
                
                {/* --- Header --- */}
                <div className="mb-4">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white break-words">
                        {title}
                    </h2>
                </div>

                {/* --- Content Area --- */}
                <div className="rounded-xl overflow-hidden bg-white/30 dark:bg-black/20 border border-gray-200/50 dark:border-white/5">
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
                </div>
            </div>

            {/* --- Expand Modal (Read-Only) --- */}
            <ExpandModal
                isOpen={isExpanded}
                onClose={handleCloseExpand}
                title={title}
                description={description}
                tagArr={[]} 
                theme={theme}
            />
        </>
    );
};

export default PublicConceptComponent;