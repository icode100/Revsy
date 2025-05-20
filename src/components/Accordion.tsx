import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';

interface AccordionProps {
    title: React.ReactNode;
    description: string;
    theme?: "dark" | "light";
}

const Accordion: React.FC<AccordionProps> = ({ title, description, theme }) => {
    const [isOpen, setIsOpen] = React.useState(false);

    const toggleAccordion = () => setIsOpen((prev) => !prev);

    return (
        <div className="accordion border border-gray-300 rounded-lg shadow-md overflow-hidden">
            <button
                className={`accordion-header w-full flex justify-between items-center text-left px-4 py-3 font-semibold text-white transition-all duration-300 ${
                    isOpen ? 'bg-blue-600' : 'bg-blue-500 hover:bg-blue-600'
                }`}
                onClick={toggleAccordion}
            >
                <span>{title}</span>
                <span className="material-icons">
                    {isOpen ? 'expand_less' : 'expand_more'}
                </span>
            </button>
            {isOpen && (
                <div className={`accordion-content ${theme==="dark"? "bg-gray-700":"bg-gray-50"} px-4 py-3`}>
                    <MarkdownRenderer content={description} theme={theme}/>
                </div>
            )}
        </div>
    );
};

export default Accordion;