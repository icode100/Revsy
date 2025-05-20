import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import MarkdownEditor from './MarkdownEditor';
interface ConceptComponentProps {
    title: string;
    description?: string;
    children?: React.ReactNode;
    theme?: 'dark' | 'light';
}

const ConceptComponent: React.FC<ConceptComponentProps> = ({
    title,
    description,
    theme
}) => {
    return (
        <div className={`p-4 rounded-lg shadow-md ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-black'}`}>
            <div className="grid grid-cols-6 gap-4">
                <div></div>
                <div></div>
                <div className={`col-start-2 col-span-2 text-center text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                    {title}
                </div>
                <div className={`col-span-2 text-center text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                    <MarkdownRenderer content={description}/>
                </div>
                <div></div>
                <div></div>
                <div></div>

            </div>
        </div>
    );
};

export default ConceptComponent;