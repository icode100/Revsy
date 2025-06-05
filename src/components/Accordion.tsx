import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';

interface AccordionProps {
    title: React.ReactNode;
    description: string;
    tagArr: string[],
    theme?: "dark" | "light";
}

const Accordion: React.FC<AccordionProps> = ({ title, tagArr, description, theme }) => {
    const [isOpen, setIsOpen] = React.useState(false);

    const toggleAccordion = () => setIsOpen((prev) => !prev);

    return (
        <div className="accordion border border-gray-300 rounded-lg shadow-md overflow-hidden">
            <button
                className={`accordion-header w-full flex justify-between items-center text-left px-4 py-3 font-semibold text-white transition-all duration-300 ${
                    isOpen ? 'bg-emerald-600' : 'bg-emerald-500 hover:bg-emerald-600'
                }`}
                onClick={toggleAccordion}
            >
                <div className="grid grid-cols-25">
                    <span className='col-span-15'>{title}</span>
                    {tagArr.length>0?(<span className='col-span-9 text-sm text-gray-300'>
                        {tagArr.map((tag, index) => (
                            <span key={index} className="inline-block mr-2 px-2 py-1 bg-gray-200 rounded-full text-xs text-black">
                                {tag}
                            </span>
                        ))}
                    </span>):(<span className='col-span-9'></span>)}
                    <div className="col-span-1">
                        <span className="material-icons">
                            {isOpen ? 'expand_less' : 'expand_more'}
                        </span>
                    </div>
                </div>
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