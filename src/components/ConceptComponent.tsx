import React, { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import MarkdownEditor from './MarkdownEditor';

interface ConceptComponentProps {
    title: string;
    description?: string;
    theme?: 'dark' | 'light';
}

const ConceptComponent: React.FC<ConceptComponentProps> = ({
    title: initialTitle,
    description: initialDescription = '',
    theme = 'light',
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription);

    const handleSave = () => {
        setIsEditing(false);
        // Implement save logic here, such as updating state or making an API call
    };

    const handleEdit = () => {
        setIsEditing(true);
    };

    return (
        <div
            className={`p-4 rounded-lg shadow-md ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-black'
                }`}
        >
            <div className="grid grid-cols-6 gap-4">
                <div></div>
                <div></div>
                <div className={`col-start-2 col-span-4 ${theme === 'dark' ? "bg-gray-900" : "bg-gray-300"} rounded-lg px-2 py-2`}>
                    <div className={`grid grid-cols-5 gap-3`}>

                        {/* Title Section */}
                        <div
                            className={`col-span-2 text-center text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-800'
                                }`}
                        >
                            {isEditing ? (
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className={`w-full p-2 rounded ${theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-black'
                                        }`}
                                />
                            ) : (
                                title
                            )}
                        </div>

                        {/* Description Section */}
                        <div className="col-span-2">
                            {isEditing ? (
                                <MarkdownEditor
                                    value={description}
                                    onChange={setDescription}
                                    theme={theme}
                                />
                            ) : (
                                <MarkdownRenderer content={description} theme={theme}/>
                            )}
                        </div>
                        {/* Action Buttons */}
                        <div className="col-span-1 text-center mt-4">
                            {isEditing ? (
                                <button
                                    onClick={handleSave}
                                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                                >
                                    Save
                                </button>
                            ) : (
                                <button
                                    onClick={handleEdit}
                                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                >
                                    Edit
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div></div>
                <div></div>
                <div></div>


            </div>
        </div>
    );
};

export default ConceptComponent;
