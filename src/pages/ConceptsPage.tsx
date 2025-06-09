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
import { parseExcelFileConcepts } from '../services/excelParser';

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;

interface ConceptPageProps {
    theme: 'dark' | 'light';
    pageId: number
    user: User | null | nulluser;
    setError?: (error: string) => void;
    name: string;
}

interface Concept {
    id: string;
    title: string;
    description: string;
}

const ConceptsPage: React.FC<ConceptPageProps> = ({ theme, pageId, user, setError, name }) => {
    const [concepts, setConcepts] = useState<Concept[]>([]);
    const { globalModalOpen, openModal, closeModal } = useModal();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [sheetName, setSheetName] = useState('');
    const [loading, setLoading] = useState(false);
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

    const handleSubmitForm = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!uploadedFile || !sheetName) {
            setError?.("Please upload a file and provide a sheet name.");
            return;
        }
        try {
            setLoading(true);
            const parsedData = await parseExcelFileConcepts(uploadedFile, sheetName);
            console.log("Parsed Data:", parsedData);
            if (parsedData.length === 0) {
                setError?.("No valid data found in the uploaded file.");
                return;
            }
            // new components
            const newComponents = await Promise.all(parsedData.map(async (data) => (
                {
                    title: data.title,
                    description: data.description,
                    componentType: 'problem',
                }
            )));

            const docRefs = await Promise.all(
                newComponents.map((component) => addComponentToPage(user?.uid || '', pageId, component))
            );
            const transformedComponents: Concept[] = docRefs.map((docRef, index) => ({
                id: docRef.id,
                title: newComponents[index].title,
                description: newComponents[index].description,
            } as Concept));

            setConcepts((prev) => [...prev, ...transformedComponents]);
            setIsModalOpen(false);
            setUploadedFile(null);
            setSheetName('');
            setLoading(false);
            closeModal();
        } catch (error) {
            console.error("Error parsing file:", error);
            setError?.("Failed to parse the uploaded file. Please check the format and try again.");
        }
    };


    useEffect(() => {
        const loadConcepts = async () => {
            if (!user || !pageId) return;
            // @ts-expect-error
            const components: Concept[] = await getComponentsOfPage(user.uid, pageId);
            const transformed = components.map(c => ({
                id: c.id,
                title: c.title,
                description: c.description,
            }));
            setConcepts(transformed);
        };

        loadConcepts();
    }, [user, pageId, concepts.length]);


    const handleDeleteConcept = async (id: string) => {
        if (!user || !pageId) return;
        await deleteComponent(user.uid, pageId, String(id));
        setConcepts(prev => prev.filter(c => c.id !== id));
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
            {isModalOpen && (
                <form className={`mt-25 p-6 rounded-lg shadow-md ${theme === "dark" ? "bg-gray-800 text-white" : "bg-white text-black"
                    }`} onSubmit={handleSubmitForm}>
                    <div className="mb-4">
                        <label htmlFor="sheet-name-id">sheet name</label>
                        <input required={true} className={`w-full px-4 py-2 rounded border ${theme === "dark"
                            ? "bg-gray-700 border-gray-600 text-white hover:bg-gray-800"
                            : "bg-gray-100 border-gray-300 text-black hover:bg-gray-200"
                            }`} type="text" id='sheet-name-id' placeholder='type the sheet name here' value={sheetName} onChange={(event) => setSheetName(event?.target.value)} />
                    </div>
                    <div className="mb-4">
                        <label htmlFor="sheet-input" className={`w-full text-blue-500 hover:underline cursor-pointer`}>
                            Upload your file <span className="material-icons">upload_file</span>
                        </label>
                        <input required={true} className="hidden" type="file" id='sheet-input' onChange={(event) => { const file = event.target.files?.[0]; setUploadedFile(file || null) }} />
                        {uploadedFile && (<p className={`mt-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Uploaded File: {uploadedFile.name}</p>)}
                    </div>
                    <div className="mb-4 py-3 px-3">
                        <button className='mx-2 bg-red-700 hover:bg-red-800 text-white rounded' onClick={() => { setIsModalOpen(!isModalOpen); closeModal(); }}><span className="material-icons">close</span></button>
                        <button disabled={loading} className={`mx-2 rounded ${loading
                            ? "bg-gray-400 cursor-not-allowed"
                            : theme === "dark"
                                ? "bg-green-600 hover:bg-green-700 text-white"
                                : "bg-green-500 hover:bg-green-600 text-white"
                            }`} type='submit'><span className="material-icons">arrow_right_alt</span></button>
                    </div>
                </form>
            )}
            {concepts.length > 0 ? (
                <div className={`mt-30 grid grid-cols-11 gap-4 p-4 ${globalModalOpen ? "blur-2xl" : ""}`}>
                    <div className="col-span-2"></div>
                    <div className="col-span-7">
                        <h1 className='text-4xl bold mb-4'>Concept Page: {name}</h1>
                        <h4> The number of concepts being {concepts.length}</h4>
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
                <div className={`mt-50 place-items-center text-5xl bold ${globalModalOpen ? "blur-2xl" : ""}`}>
                    <div className="grid grid-cols-3 gap-10">
                        <button
                            className={`${theme === 'dark' ? ' text-white hover:underline' : 'text-gray-900 hover:underline'
                                } ${globalModalOpen ? "blur-2xl" : ""}`}
                            onClick={handleAddConcept} title='add concept'
                        >Add</button>
                        <span>|</span>
                        <div className={`${theme === 'dark' ? ' text-white hover:underline' : 'text-gray-900 hover:underline'
                            } `}>
                            <button className={`${theme === 'dark' ? ' text-white hover:underline' : 'text-gray-900 hover:underline'
                                }`} onClick={() => { setIsModalOpen(!isModalOpen); openModal(); }}>Upload</button>
                        </div>
                    </div>
                </div>

            )}

        </div>
    );
};

export default ConceptsPage;
