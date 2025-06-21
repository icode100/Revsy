import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import type { Problem } from './ProblemComponent';
// import Accordion from './Accordion';

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
  setError: (error: string) => void;
}

const Accordion: React.FC<AccordionProps> = ({ title, tagArr, description, theme }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const toggleAccordion = () => setIsOpen((prev) => !prev);
  const getTagColor = (tagArr: string[]) => {
    const lowerTags = tagArr.map(tag => tag.toLowerCase());
    if (lowerTags.includes('heap') || tagArr.includes('Heap')) return 'text-white bg-[#800000] hover:bg-[#570000]'; // maroon
    if (lowerTags.includes('hard') || tagArr.includes('Hard')) return 'bg-red-500 hover:bg-red-600';
    if (lowerTags.includes('medium')) return 'bg-yellow-500 hover:bg-yellow-600';
    if (lowerTags.includes('easy')) return 'bg-green-600 hover:bg-green-700';
    if (lowerTags.includes('normal')) return 'bg-blue-600 hover:bg-blue-700';
    return 'bg-gray-500 hover:bg-gray-600'; // default
  };
  const getTagColorOpen = (tagArr: string[]) => {
    const lowerTags = tagArr.map(tag => tag.toLowerCase());
    if (lowerTags.includes('heap')) return 'text-white bg-[#570000]'; // maroon
    if (lowerTags.includes('hard')) return 'bg-red-600';
    if (lowerTags.includes('medium')) return 'bg-yellow-600';
    if (lowerTags.includes('easy')) return 'bg-green-700';
    if (lowerTags.includes('normal')) return 'bg-blue-700';
    return 'bg-gray-600'; // default
  };
  return (
    <div className="accordion border border-gray-300 rounded-lg shadow-md overflow-hidden text-sm">
      <button
        className={`accordion-header w-full flex justify-between items-center text-left px-2 py-2 font-semibold transition-all duration-300 ${isOpen ? getTagColorOpen(tagArr) : getTagColor(tagArr)}`}
        onClick={toggleAccordion}
      >
        <div className="flex items-center">
          <span>{title}</span>
          {tagArr.length > 0 && (
            <span className="ml-2 text-xs text-gray-300">
              {tagArr.map((tag, index) => (
                <span key={index} className="inline-block mr-1 px-1 py-0.5 bg-gray-200 rounded-full text-black">
                  {tag}
                </span>
              ))}
            </span>
          )}
        </div>
        <span className="material-icons">{isOpen ? 'expand_less' : 'expand_more'}</span>
      </button>
      {isOpen && (
        <div className={`accordion-content ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'} px-2 py-2`}>
          <MarkdownRenderer content={description} theme={theme} />
        </div>
      )}
    </div>
  );
};

const PublicProblemComponent: React.FC<PublicProblemComponentProps> = ({ problems, note, theme }) => {
  return (
    <div className={`p-2 rounded-lg shadow-md ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-black'}`}>
      <div className="grid grid-cols-2 gap-2">
        {/* Problems Section */}
        <div>
          {problems.length > 0 ? (
            problems.map((problem) => (
              <div key={problem.id} className="mb-2">
                <Accordion
                  title={
                    <a
                      href={problem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`hover:underline text-white`}
                    >
                      {problem.title}
                    </a>
                  }
                  description={problem.description}
                  tagArr={problem.tagArr}
                  theme={theme}
                  setError={() => { }} // No error handling needed for public view
                />
              </div>
            ))
          ) : (
            <div className="text-center text-sm italic">No problems available.</div>
          )}
        </div>

        {/* Notes Section */}
        <div className={`p-2 mr-35 rounded-lg ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'}`}>
          <MarkdownRenderer content={note} theme={theme} />
        </div>
      </div>
    </div>
  );
};

export default PublicProblemComponent;