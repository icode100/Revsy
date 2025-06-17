import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';

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

    return (
        <div
            className={`p-4 rounded-lg shadow-md ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-black'
                }`}
        >
            <div className="grid grid-cols-3 gap-2">
                <div></div>
                <div
                    className={`col-start-1 col-span-3 ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-300'
                        } rounded-lg px-2 py-4`}
                >
                    <div className="grid grid-cols-9 gap-3">
                        {/* Title Section */}
                        <div
                            className={`col-span-4 text-center text-xl font-bold rounded-lg ${theme === 'dark' ? 'text-white bg-gray-700' : 'text-gray-800 bg-white'
                                }`}
                        >
                            <div className="h-full place-content-center">
                                <MarkdownRenderer content={title} theme={theme} />
                            </div>

                        </div>

                        {/* Description Section */}
                        <div className="col-span-4">
                            <div
                                className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-white'
                                    } rounded-lg px-2 py-2 h-full place-content-center`}
                            >
                                <MarkdownRenderer content={description} theme={theme} />
                            </div>
                        </div>
                    </div>
                </div>
                <div></div>
            </div>
        </div>
    );
};

export default PublicConceptComponent;
