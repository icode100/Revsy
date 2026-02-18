/* eslint-disable @typescript-eslint/ban-ts-comment */
import React, { useState, useEffect, useRef, useCallback } from 'react';
const ConceptComponent = React.lazy(() => import('../components/ConceptComponent'));
import { useModal } from '../components/ModalContext';
import {
    addComponentToPage,
    getComponentsOfPage,
    updateComponent,
    deleteComponent,
} from '../services/firestore';
import type { signInWithEmail, signOut } from '../services/firebaseAuth';
import { parseExcelFileConcepts } from '../services/excelParser';
import { throttle } from 'lodash';

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;

export interface ConceptPageProps {
    theme: 'dark' | 'light';
    pageId: number
    user: User | null | nulluser;
    setError?: (error: string) => void;
    name: string;
}

export interface Concept {
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
    const [isReversed, setIsReversed] = useState(false);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [showScrollUpButton, setShowScrollUpButton] = useState(false);
    
    const pageEndRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null); // Ref for title animation

    const toggleOrder = () => {
        setIsReversed(prev => !prev);
    };

    // --- Optimized Scroll Animation Logic ---
    useEffect(() => {
        const handleVisualScroll = () => {
            if (!headerRef.current) return;
            const scrollY = window.scrollY;
            
            // Fade out within 300px
            const opacity = Math.max(0, 1 - scrollY / 300);
            // Shrink from 1 to 0.8
            const scale = Math.max(0.8, 1 - scrollY / 1000);
            // Move up to avoid overlap
            const translateY = Math.min(50, scrollY / 2);

            headerRef.current.style.opacity = opacity.toString();
            headerRef.current.style.transform = `scale(${scale}) translateY(-${translateY}px)`;
            headerRef.current.style.visibility = opacity <= 0 ? 'hidden' : 'visible';
        };

        window.addEventListener('scroll', handleVisualScroll);
        return () => window.removeEventListener('scroll', handleVisualScroll);
    }, []);

    const handleScroll = () => {
        const scrollTop = window.scrollY;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;

        const shouldShowScrollButton = scrollTop + windowHeight < documentHeight - 100;
        const shouldShowScrollUpButton = scrollTop > 100;

        if (showScrollButton !== shouldShowScrollButton) setShowScrollButton(shouldShowScrollButton);
        if (showScrollUpButton !== shouldShowScrollUpButton) setShowScrollUpButton(shouldShowScrollUpButton);
    };

    const throttledHandleScroll = useRef(throttle(handleScroll, 100)).current;

    const scrollToBottom = useCallback(() => {
        pageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    const scrollToTop = useCallback(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleAddConcept = async () => {
        if (!user || !pageId) return;
        const newComponent = {
            title: 'Edit your title here',
            description: 'Edit your description here',
            componentType: 'concept',
        };
        const docRef = await addComponentToPage(user.uid, pageId, newComponent);
        setConcepts(prev => [...prev, { ...newComponent, id: docRef.id }]);
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
            if (parsedData.length === 0) {
                setError?.("No valid data found in the uploaded file.");
                return;
            }
            
            const newComponents = await Promise.all(parsedData.map(async (data) => (
                {
                    title: data.title,
                    description: data.description,
                    componentType: 'concept', // Fixed type consistency
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
            setError?.("Failed to parse the uploaded file.");
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
        window.addEventListener('scroll', throttledHandleScroll);
        return () => window.removeEventListener('scroll', throttledHandleScroll);
    }, [user, pageId, throttledHandleScroll]);


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
        <>
            <div className="page-container">
                
                {/* --- Floating Action Buttons --- */}
                <div className="fixed top-24 right-6 z-40 flex flex-col gap-3">
                    <button
                        className="fab-glass"
                        onClick={toggleOrder}
                        title={isReversed ? "Show oldest first" : "Show newest first"}
                    >
                        {isReversed ? (
                            <span className='material-icons'>keyboard_double_arrow_down</span>
                        ) : (
                            <span className='material-icons'>keyboard_double_arrow_up</span>
                        )}
                    </button>
                </div>

                <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3">
                    {showScrollUpButton && (
                        <button className="fab-glass fab-primary" onClick={scrollToTop}>
                            <span className="material-icons">arrow_upward</span>
                        </button>
                    )}
                    {showScrollButton && (
                        <button className="fab-glass fab-primary" onClick={scrollToBottom}>
                            <span className="material-icons">arrow_downward</span>
                        </button>
                    )}
                </div>

                {/* --- Page Header with Animation --- */}
                <div className="relative mb-16 text-center h-[120px] flex items-center justify-center pointer-events-none">
                    <div ref={headerRef} className="w-full flex flex-col items-center justify-center origin-center transition-transform duration-75 ease-out">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-purple-500/10 rounded-full blur-[80px]" />
                        <h1 className="text-page-title relative z-10">{name}</h1>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/5 backdrop-blur-md text-xs font-medium text-gray-500 dark:text-gray-400 relative z-10">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
                            {concepts.length} {concepts.length === 1 ? 'Concept' : 'Concepts'}
                        </div>
                    </div>
                </div>

                {/* --- Import Modal --- */}
                {isModalOpen && (
                    <div className="modal-overlay">
                        <form className="modal-glass" onSubmit={handleSubmitForm}>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Import Concepts</h3>
                                <button type="button" className="btn-icon-glass" onClick={() => { setIsModalOpen(false); closeModal(); }}>
                                    <span className="material-icons">close</span>
                                </button>
                            </div>
                            <div className="space-y-6">
                                <div>
                                    <label htmlFor="sheet-name-id" className="label-text">Sheet Name</label>
                                    <input required id='sheet-name-id' type="text" className="input-field" placeholder='e.g., Concepts' value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
                                </div>
                                <div>
                                    <label className="label-text mb-2">Upload Excel File</label>
                                    <label htmlFor="sheet-input" className="upload-zone block">
                                        <span className="material-icons text-4xl text-purple-500 mb-2">upload_file</span>
                                        <p className="text-sm text-gray-600 dark:text-gray-300">{uploadedFile ? uploadedFile.name : "Click to select file"}</p>
                                        <input required className="hidden" type="file" id='sheet-input' accept=".xlsx, .xls" onChange={(e) => setUploadedFile(e.target.files?.[0] || null)} />
                                    </label>
                                </div>
                                <button disabled={loading} className="btn-submit flex items-center justify-center gap-2" type='submit'>
                                    {loading ? "Importing..." : "Import Data"}
                                    {!loading && <span className="material-icons">arrow_forward</span>}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* --- Content Area --- */}
                {concepts.length > 0 ? (
                    <div className={`max-w-5xl mx-auto space-y-8 ${globalModalOpen ? "blur-md" : ""}`}>
                        {(isReversed ? [...concepts].reverse() : concepts).map((concept) => (
                            <React.Suspense fallback={<div className="glass-panel p-8 text-center">Loading...</div>} key={concept.id}>
                                <ConceptComponent
                                    id={concept.id}
                                    title={concept.title}
                                    description={concept.description}
                                    theme={theme}
                                    onDelete={handleDeleteConcept}
                                    onTitleChange={(id, newTitle) => updateConceptField(id, 'title', newTitle)}
                                    onDescriptionChange={(id, newDesc) => updateConceptField(id, 'description', newDesc)}
                                />
                            </React.Suspense>
                        ))}
                        <div className="pt-4">
                            <button className="btn-add-floating" onClick={handleAddConcept}>
                                <span className="material-icons">add_circle</span>
                                <span>Add New Concept</span>
                            </button>
                        </div>
                    </div>
                ) : (
                    /* --- Empty State --- */
                    <div className={`min-h-[50vh] flex flex-col items-center justify-center ${globalModalOpen ? "blur-md" : ""}`}>
                        <div className="glass-panel p-10 rounded-3xl text-center max-w-lg mx-auto">
                            <div className="mb-6 flex justify-center">
                                <div className="w-20 h-20 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                                    <span className="material-icons text-4xl">lightbulb</span>
                                </div>
                            </div>
                            <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">Start Documenting</h2>
                            <p className="text-gray-500 dark:text-gray-400 mb-8">Add concepts manually or import them from your knowledge base.</p>
                            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                <button className="btn-secondary" onClick={handleAddConcept}>
                                    <span className="material-icons text-purple-500">add</span>
                                    Create New
                                </button>
                                <button className="btn-secondary" onClick={() => { setIsModalOpen(true); openModal(); }}>
                                    <span className="material-icons text-blue-500">upload_file</span>
                                    Import Excel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                
                <div ref={pageEndRef}></div>
            </div>
        </>
    );
};

export default ConceptsPage;