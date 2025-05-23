import React, { useState } from 'react';
import ConceptComponent from '../components/ConceptComponent';
import { useModal } from '../components/ModalContext';
interface ConceptPageProps {
    theme: 'dark' | 'light';
}

interface Concept {
    id: number;
    title: string;
    description: string;
}

const ConceptsPage: React.FC<ConceptPageProps> = ({ theme }) => {
    const [concepts, setConcepts] = useState<Concept[]>([]);
    const { globalModalOpen } = useModal();
    const handleAddConcept = () => {
        const newConcept: Concept = {
            id: Date.now(),
            title: 'Edit your title here',
            description: 'Edit your description here',
        };
        setConcepts((prevConcepts) => [...prevConcepts, newConcept]);
    };

    const handleDeleteConcept = (id: number) => {
        setConcepts((prevConcepts) => prevConcepts.filter((concept) => concept.id !== id));
    };

    const handleTitleChange = (id: number, newTitle: string) => {
        setConcepts((prevConcepts) =>
            prevConcepts.map((concept) =>
                concept.id === id ? { ...concept, title: newTitle } : concept
            )
        );
    };

    const handleDescriptionChange = (id: number, newDescription: string) => {
        setConcepts((prevConcepts) =>
            prevConcepts.map((concept) =>
                concept.id === id ? { ...concept, description: newDescription } : concept
            )
        );
    };

    return (
        <div
            className={`min-h-screen p-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'
                } ${concepts.length === 0 ? "place-items-center" : ""}`}
        >
            {concepts.length > 0 ? (
                <div className="grid grid-cols-11 gap-4 p-4 mt-21">
                    <div className="col-span-2"></div>
                    <div className="col-span-7">
                        <div className="grid grid-cols-19">
                            <div className="space-y-4 col-span-19">
                                {concepts.map((concept) => (
                                    <ConceptComponent
                                        key={concept.id}
                                        id={concept.id}
                                        title={concept.title}
                                        description={concept.description}
                                        theme={theme}
                                        onDelete={handleDeleteConcept}
                                        onTitleChange={handleTitleChange}
                                        onDescriptionChange={handleDescriptionChange}
                                    />
                                ))}
                            </div>
                            <div className="col-span-1 mt-4">
                                <button
                                    className={`px-4 py-2 rounded ${theme === 'dark' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
                                        } text-white ${globalModalOpen ? "blur-2xl" : ""}`}
                                    onClick={handleAddConcept}
                                >
                                    +
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

            ) : (
                <div className=' mt-10 place-items-center text-9xl bold'>
                    <div className="">
                        <button
                            className={`px-100 py-90 rounded-full ${theme === 'dark' ? ' text-white border-2 border-solid-black hover:border-dotted' : 'text-gray-900 border-2 border-solid-black hover:border-dotted'
                                } ${globalModalOpen ? "blur-2xl" : ""}`}
                            onClick={handleAddConcept} title='add concept'
                        >
                            +
                        </button>
                    </div>
                </div>

            )}

        </div>
    );
};

export default ConceptsPage;
