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

const Accordion: React.FC<AccordionProps> = ({ title, tagArr, description, theme}) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const toggleAccordion = () => setIsOpen((prev) => !prev);

  return (
    <div className="accordion border border-gray-300 rounded-lg shadow-md overflow-hidden text-sm">
      <button
        className={`accordion-header w-full flex justify-between items-center text-left px-2 py-2 font-semibold transition-all duration-300 ${
          isOpen ? 'bg-emerald-600' : 'bg-emerald-500 hover:bg-emerald-600'
        }`}
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
                  setError={() => {}} // No error handling needed for public view
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