import React, { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import type { Problem } from './ProblemComponent';
import ExpandModal from './ExpandModal';
import { useModal } from '../components/ModalContext';

interface PublicProblemComponentProps {
  id: string;
  problems: Problem[];
  note: string;
  theme: 'dark' | 'light';
}

interface AccordionProps {
  title: React.ReactNode;
  description: string;
  tagArr: string[];
  theme?: 'dark' | 'light';
  onExpand: () => void;
}

const Accordion: React.FC<AccordionProps> = ({ title, tagArr, description, theme, onExpand }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const toggleAccordion = () => setIsOpen((prev) => !prev);
  
  const getBadgeStyle = (tag: string) => {
    const t = tag.toLowerCase();
    if (t === 'hard') return 'badge-red';
    if (t === 'medium') return 'badge-yellow';
    if (t === 'easy') return 'badge-green';
    if (t === 'heap') return 'badge-maroon';
    if (['dp', 'graph', 'tree', 'normal'].includes(t)) return 'badge-blue';
    return 'badge-gray';
  };

  const getDifficultyBorder = (tags: string[]) => {
    const lowerTags = tags.map(t => t.toLowerCase());
    if (lowerTags.includes('hard')) return 'border-hard';
    if (lowerTags.includes('medium')) return 'border-medium';
    if (lowerTags.includes('easy')) return 'border-easy';
    return 'border-default';
  };

  return (
    <div className={`accordion-glass mb-3 ${getDifficultyBorder(tagArr)} overflow-hidden`}>
      <button
        className={`accordion-header group text-sm ${isOpen ? 'bg-gray-50/50 dark:bg-white/5' : ''}`}
        onClick={toggleAccordion}
      >
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-500 transition-colors">
                {title}
            </span>
            <div className="hidden sm:flex gap-1">
              {tagArr.slice(0, 2).map((tag, idx) => (
                <span key={idx} className={`badge scale-90 ${getBadgeStyle(tag)}`}>{tag}</span>
              ))}
            </div>
          </div>
          <span className={`material-icons text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </div>
      </button>

      <div className={`grid transition-all duration-300 ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="accordion-scroll-box custom-scrollbar !max-h-[200px]">
            <MarkdownRenderer content={description} theme={theme} />
          </div>
          <div className="accordion-actions !py-2 !px-4">
             <button className="btn-expand" onClick={onExpand}>
                <span className="material-icons text-[14px]">open_in_full</span>
                Expand
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const PublicProblemComponent: React.FC<PublicProblemComponentProps> = ({ problems, note, theme }) => {
  const [expandedContent, setExpandedContent] = useState<{ title: string, description: string, tagArr: string[] } | null>(null);
  const { openModal, closeModal } = useModal();

  const handleExpandProblem = (p: Problem) => {
    setExpandedContent({ title: p.title, description: p.description, tagArr: p.tagArr });
    openModal();
  };

  const handleExpandNotes = () => {
    setExpandedContent({ title: "Section Notes", description: note, tagArr: [] });
    openModal();
  };

  const handleClose = () => {
    setExpandedContent(null);
    closeModal();
  };

  return (
    <>
      <div className="problem-component-wrapper">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          
          {/* Problems List */}
          <div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400 dark:text-neutral-500 mb-4 ml-1">
                Problems
            </h3>
            {problems.length > 0 ? (
              problems.map((problem) => (
                <Accordion
                  key={problem.id}
                  title={
                    <a href={problem.url} target="_blank" rel="noopener noreferrer">
                      {problem.title}
                    </a>
                  }
                  description={problem.description}
                  tagArr={problem.tagArr}
                  theme={theme}
                  onExpand={() => handleExpandProblem(problem)}
                />
              ))
            ) : (
              <div className="glass-panel p-6 text-center text-sm italic text-gray-500 rounded-2xl">
                No problems in this section.
              </div>
            )}
          </div>

          {/* Notes Section */}
          <div className="flex flex-col">
             <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400 dark:text-neutral-500 mb-4 ml-1">
                Concept Notes
            </h3>
            <div className="glass-panel rounded-2xl overflow-hidden flex flex-col">
                <div className="notes-scroll-box custom-scrollbar !max-h-[350px]">
                    <MarkdownRenderer content={note} theme={theme} />
                </div>
                <div className="accordion-actions">
                    <button className="btn-expand w-full justify-center" onClick={handleExpandNotes}>
                        <span className="material-icons text-xs">open_in_full</span>
                        Expand Notes
                    </button>
                </div>
            </div>
          </div>
        </div>
      </div>

      <ExpandModal
        isOpen={!!expandedContent}
        onClose={handleClose}
        title={expandedContent?.title || ''}
        description={expandedContent?.description || ''}
        tagArr={expandedContent?.tagArr || []}
        theme={theme}
      />
    </>
  );
};

export default PublicProblemComponent;