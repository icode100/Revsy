import React, { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModal } from '../components/ModalContext';
import { togglePagePublicStatus, isPagePublic } from '../services/firestore';
import type { signInWithEmail, signOut } from '../services/firebaseAuth';

type User = Awaited<ReturnType<typeof signInWithEmail>>;
type nulluser = Awaited<ReturnType<typeof signOut>>;

export type PageDef = {
  id: number;
  type: 'problem' | 'concept';
  name: string;
  path: string;
};

interface MainPageProps {
  pages: PageDef[];
  addPage: (type: PageDef['type'], name: string) => void;
  theme: 'dark' | 'light';
  deletePage: (id: number) => void;
  error: string | null;
  setError: (error: string | null) => void;
  user: User | null | nulluser;
  alert: string | null;
  setAlert: (alert: string | null) => void;
}

const MainPage: React.FC<MainPageProps> = ({ pages, addPage, deletePage, setError, user, setAlert }) => {
  const [type, setType] = useState<PageDef['type']>('problem');
  const [name, setName] = useState('');
  const [pageLocks, setPageLocks] = useState<Record<number, boolean>>(() =>
    pages.reduce((acc, page) => ({ ...acc, [page.id]: false }), {})
  );
  const navigate = useNavigate();
  const { globalModalOpen } = useModal();
  const userId = user ? user.uid : "";

  useEffect(() => {
    const fetchPageLocks = async () => {
      if (!user) return;
      try {
        const locks: Record<number, boolean> = {};
        for (const page of pages) {
          const isPublic = await isPagePublic(user.uid, page.id);
          locks[page.id] = isPublic;
        }
        setPageLocks(locks);
      } catch (err) {
        console.error("Failed to fetch page locks:", err);
        setError("Failed to fetch page locks.");
      }
    };
    fetchPageLocks();
  }, [pages, user, setError]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError("You must be logged in to add a page.");
      return;
    }
    if (!name.trim()) return;
    addPage(type, name.trim());
    setName('');
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this page?')) {
      deletePage(id);
    }
  };

  const toggleLock = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!user) return;
    try {
      const currentStatus = !!pageLocks[id];
      await togglePagePublicStatus(user.uid, id, !currentStatus);
      setPageLocks(prev => ({ ...prev, [id]: !currentStatus }));
      setAlert(!currentStatus ? 'Page is now public' : 'Page is now private');
    } catch (err) {
      console.error(err);
      setError("Failed to toggle lock status.");
    }
  };

  const handleShare = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const page = pages.find(p => p.id === id);
    if (page) {
        const url = `${window.location.origin}/view/${page.type}/${userId}/${id}`;
        navigator.clipboard.writeText(url);
        setAlert('Public link copied to clipboard');
    }
  };

  return (
    <div className="app-bg min-h-screen relative overflow-hidden">
      
      {/* --- RESTORED BACKGROUND ANIMATIONS --- */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none">
         {/* Grid Pattern Layer */}
         <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.03] bg-grid-black dark:bg-grid-white" />
         
         {/* Animated Aurora Blobs */}
         <div className="blob-base blob-purple opacity-40 dark:opacity-20" />
         <div className="blob-base blob-cyan opacity-40 dark:opacity-20" />
         <div className="blob-base blob-pink opacity-40 dark:opacity-20" />
         
         {/* Subtle Vignette */}
         <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/5 dark:to-black/20" />
      </div>

      {/* --- CONTENT WRAPPER --- */}
      <div className={`relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-20 transition-all duration-500 ${globalModalOpen ? "blur-sm scale-[0.98]" : ""}`}>
        
        {/* --- Header Section --- */}
        <div className="text-center mb-12">
            <h1 className="text-brand text-5xl md:text-7xl mb-4 font-black tracking-tighter">Dashboard</h1>
            <p className="text-gray-500 dark:text-neutral-400 font-medium tracking-wide">
                Manage your problems and learning concepts
            </p>
        </div>

        {/* --- Create Bar --- */}
        <div className="flex justify-center mb-20">
          <form
            onSubmit={handleSubmit}
            className="group flex flex-col sm:flex-row items-center gap-2 p-2 pl-3 rounded-2xl glass-panel shadow-2xl hover:bg-white/80 dark:hover:bg-neutral-900/40 transition-all border-white/20 dark:border-white/10"
          >
            {/* Type Toggle */}
            <div className="flex p-1 rounded-xl bg-gray-100/50 dark:bg-black/40 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setType('problem')}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-300 ${type === 'problem' ? 'bg-white text-purple-600 shadow-md dark:bg-neutral-800 dark:text-purple-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
              >
                Problem
              </button>
              <button
                type="button"
                onClick={() => setType('concept')}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-300 ${type === 'concept' ? 'bg-white text-cyan-600 shadow-md dark:bg-neutral-800 dark:text-cyan-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
              >
                Concept
              </button>
            </div>

            {/* Input Field */}
            <div className="flex-grow w-full sm:w-[300px] md:w-[400px]">
                <input
                    className="w-full px-4 py-3 sm:py-2 bg-transparent border-none outline-none text-gray-800 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-600 font-medium"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    placeholder="Enter page title..."
                />
            </div>

            {/* Submit Button */}
            <button type="submit" className="w-full sm:w-auto px-8 py-2.5 btn-gradient flex items-center justify-center gap-2">
              <span className="material-icons text-lg">add_circle</span>
              <span>Create</span>
            </button>
          </form>
        </div>

        {/* --- Pages Grid --- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {pages.map(p => (
            <div
              key={p.id}
              onClick={() => navigate(p.path)}
              className="group glass-card p-7 flex flex-col justify-between h-[240px] hover:-translate-y-2 transition-all duration-300"
            >
              <div>
                <div className="flex justify-between items-start mb-5">
                  <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] rounded-md border backdrop-blur-md ${p.type === 'problem' ? 'tag-problem' : 'tag-concept'}`}>
                    {p.type}
                  </span>
                  
                  {/* Status Indicator Glow */}
                  <div className={`w-2.5 h-2.5 rounded-full transition-all duration-700 ${pageLocks[p.id] ? 'bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.6)]' : 'bg-neutral-600 dark:bg-neutral-800'}`} />
                </div>
                
                <h2 className="text-2xl font-bold truncate pr-2 mb-2 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
                  {p.name}
                </h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-neutral-600">
                    ID: {p.id.toString().slice(-6)}
                </p>
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center justify-between mt-8 pt-5 border-t border-dashed border-gray-200 dark:border-white/5 group-hover:border-white/10 transition-colors">
                <div className="flex gap-2">
                  <button
                    onClick={(e) => toggleLock(e, p.id)}
                    className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 
                      ${!pageLocks[p.id] 
                        ? 'bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-white/5 dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-white' 
                        : 'text-green-600 bg-green-100 hover:bg-green-200 dark:text-green-400 dark:bg-green-400/10 dark:hover:bg-green-400/20 shadow-inner'
                      }`}
                    title={pageLocks[p.id] ? "Revoke Access" : "Set Public"}
                  >
                    <span className="material-icons text-lg">
                        {pageLocks[p.id] ? 'lock_open' : 'lock'}
                    </span>
                  </button>
                  
                  <button
                    onClick={(e) => handleShare(e, p.id)}
                    disabled={!pageLocks[p.id]}
                    className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300
                      ${!pageLocks[p.id]
                        ? 'opacity-10 grayscale cursor-not-allowed' 
                        : 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-400/10 dark:hover:bg-blue-400/20 hover:scale-110'
                      }`}
                    title="Copy Share Link"
                  >
                    <span className="material-icons text-lg">share</span>
                  </button>
                </div>

                <button
                  onClick={(e) => handleDelete(e, p.id)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                  title="Delete Page"
                >
                  <span className="material-icons text-lg">delete_sweep</span>
                </button>
              </div>
            </div>
          ))}
          
          {pages.length === 0 && (
            <div className="col-span-full py-32 text-center border-2 border-dashed rounded-[3rem] flex flex-col items-center justify-center border-gray-200 dark:border-neutral-900">
              <div className="w-20 h-20 rounded-full mb-6 bg-gray-100 dark:bg-white/5 flex items-center justify-center">
                <span className="material-icons text-5xl text-gray-300 dark:text-neutral-700">folder_open</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-400 dark:text-neutral-700">No pages yet</h3>
              <p className="text-sm text-gray-400 dark:text-neutral-600 mt-2 max-w-xs mx-auto">
                Create your first problem set or concept guide to get started with Revsy.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MainPage;