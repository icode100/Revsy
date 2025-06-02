/* eslint-disable @typescript-eslint/ban-ts-comment */
import React, { useState, useEffect } from 'react';
import ConceptComponent from '../components/ConceptComponent';
import { useModal } from '../components/ModalContext';
import {
    addComponentToPage,
    getComponentsOfPage,
    updateComponent,
    deleteComponent,
} from '../services/firestore';
import type { signInWithEmail, signOut } from '../services/firebaseAuth';

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;

interface ConceptPageProps {
    theme: 'dark' | 'light';
    pageId: number
    user: User | null | nulluser;
}

interface Concept {
    id: string;
    title: string;
    description: string;
}

const ConceptsPage: React.FC<ConceptPageProps> = ({ theme, pageId, user }) => {
    const [concepts, setConcepts] = useState<Concept[]>([]);
    const { globalModalOpen } = useModal();
    const [ConceptNumber, setConceptNumber] = useState<number>(0);
    const handleAddConcept = async () => {
        if (!user || !pageId) return;
        const newComponent = {
            title: 'Edit your title here',
            description: 'Edit your description here',
            componentType: 'concept',
        };
        const docRef = await addComponentToPage(user.uid, pageId, newComponent);
        setConcepts(prev => [...prev, { ...newComponent, id: docRef.id }]); // OR include doc ID
    };


    useEffect(() => {
        const loadConcepts = async () => {
            if (!user || !pageId) return;
            // @ts-expect-error
            const components:Concept[] = await getComponentsOfPage(user.uid, pageId);
            const transformed = components.map(c => ({
                id: c.id,
                title: c.title,
                description: c.description,
            }));
            setConcepts(transformed);
        };

        loadConcepts();
        setConceptNumber(concepts.length);
    }, [user, pageId, setConceptNumber, concepts.length]);


    const handleDeleteConcept = async (id: string) => {
        if (!user || !pageId) return;
        await deleteComponent(user.uid, pageId, String(id));
        setConcepts(prev => prev.filter(c => c.id !== id));
        setConceptNumber(prev => prev - 1);
    };


    const updateConceptField = async (id: string, field: 'title' | 'description', value: string) => {
        if (!user || !pageId) return;
        setConcepts(prev =>
            prev.map(c => c.id === id ? { ...c, [field]: value } : c)
        );
        await updateComponent(user.uid, pageId, String(id), { [field]: value });
    };


    return (
        <div
            className={`min-h-screen p-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'
                } ${concepts.length === 0 ? "place-items-center" : ""} `}
        >
            {concepts.length > 0 ? (
                <div className={`mt-30 grid grid-cols-11 gap-4 p-4 ${globalModalOpen ? "blur-2xl" : ""}`}>
                    <div className="col-span-2"></div>
                    <div className="col-span-7">
                        <h4> The number of concepts being {ConceptNumber}</h4>
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
                                        onTitleChange={(id, newTitle) => updateConceptField(id, 'title', newTitle)}
                                        onDescriptionChange={(id, newDesc) => updateConceptField(id, 'description', newDesc)}
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
                <div className='mt-20 place-items-center text-9xl bold'>
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
