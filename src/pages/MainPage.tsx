// src/pages/MainPage.tsx
import React, { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModal } from '../components/ModalContext';
import { togglePagePublicStatus, isPagePublic } from '../services/firestore'; // Import Firestore functions
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
  error: string | null,
  setError: (error: string | null) => void;
  user: User | null | nulluser; // Replace with actual user type
  alert: string | null,
  setAlert: (alert: string | null) => void;
}

const MainPage: React.FC<MainPageProps> = ({ pages, addPage, theme, deletePage, setError, user, setAlert }) => {
  const [type, setType] = useState<PageDef['type']>('problem');
  const [name, setName] = useState('');
  const [pageLocks, setPageLocks] = useState<Record<number, boolean>>(() =>
    pages.reduce((acc, page) => ({ ...acc, [page.id]: true }), {})
  ); // Default all pages to locked
  const navigate = useNavigate();
  const { globalModalOpen } = useModal();
  const userId = user ? user.uid: ""
  useEffect(() => {
    const fetchPageLocks = async () => {
      if (!user) return;

      try {
        const locks: Record<number, boolean> = {};
        for (const page of pages) {
          const isPublic = await isPagePublic(user.uid, page.id);
          locks[page.id] = isPublic; // Locked if not public
        }
        setPageLocks(locks);
      } catch (err) {
        console.error("Failed to fetch page locks:", err);
        setError("Failed to fetch page locks.");
      }
    };

    fetchPageLocks();
    console.log(pageLocks);
  }, [pages, user, setError, pageLocks]);


  const handleSubmit = (e: FormEvent) => {
    if (!user) {
      setError("You must be logged in to add a page.");
    }
    e.preventDefault();
    if (!name.trim()) return;
    addPage(type, name.trim());
    setName('');
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this page?')) {
      deletePage(id);
    }
  };

  const toggleLock = async (id: number) => {
    if (!user) return;
    try {
      const currentStatus = await isPagePublic(user.uid, id);
      await togglePagePublicStatus(user.uid, id, !currentStatus);
      setPageLocks(prev => ({ ...prev, [id]: !currentStatus }));
    } catch (err) {
      console.error(err);
      setError("Failed to toggle lock status.");
    }
  };

  return (
    <div className={`min-h-screen p-6 ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'} text-center`}>
      <form
        className={`inline-block mt-30 mb-8 p-4 rounded shadow ${theme === 'dark' ? 'bg-gray-300 text-gray-800' : 'bg-gray-800 text-white'} ${globalModalOpen ? "blur-2xl" : ""}`}
        onSubmit={handleSubmit}
      >
        <label className="mr-2">
          Page Type:
          <select
            className="ml-1 rounded-lg"
            value={type}
            onChange={e => setType(e.target.value as PageDef['type'])}
          >
            <option className={`${theme === 'dark' ? "bg-gray-800 text-white hover:bg-black" : "bg-gray-200 text-gray-800 hover:bg-gray-300"}`} value="concept">Concept</option>
            <option className={`${theme === 'dark' ? "bg-gray-800 text-white hover:bg-black" : "bg-gray-200 text-gray-800 hover:bg-gray-300"}`} value="problem">Problem</option>
          </select>
        </label>
        <label className="mx-2">
          Name:
          <input
            className="ml-1 px-2 py-1 border rounded"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            placeholder="e.g. Graphs"
          />
        </label>
        <button
          type="submit"
          className="ml-2 px-4 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Add
        </button>
      </form>
      <div className="grid grid-cols-7">
        <div className="col-span-1"></div>
        <div className=" col-span-5 grid grid-cols-2 md:grid-cols-4 gap-6">
          {pages.map(p => (
            <div className='grid grid-cols-5 gap-2'>
              <div
                key={p.id}
                onClick={() => navigate(p.path)}
                className={`
                col-span-4 cursor-pointer p-6 rounded-lg shadow-lg ${globalModalOpen ? "blur-2xl" : ""}
                ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-black'}
                hover:shadow-2xl transition
              `}
              >
                <h2 className="text-xl font-semibold">{p.name}</h2>
                <p className="text-sm text-gray-500 capitalize">{p.type}</p>
              </div>

              <div className="col-span-1 flex flex-col items-center">
                <button
                  className={`rounded-lg px-2 py-3 ${pageLocks[p.id] ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-500 hover:bg-green-600'} text-white`}
                  onClick={() => toggleLock(p.id)}
                  title={pageLocks[p.id] ? 'Lock' : 'Unlock'}
                >
                  <span className="material-icons">{pageLocks[p.id] ? 'lock' : 'lock_open'}</span>
                </button>
                <button
                  className={`mt-2 px-2 py-3 rounded-lg ${pageLocks[p.id]==false?"bg-gray-400":"bg-blue-500 hover:bg-blue-600"} text-white`}
                  onClick={() => {navigator.clipboard.writeText(`${window.location.origin}/view/${p.type}/${userId}+${p.id}`);setAlert('link copied');}}
                  title={`${pageLocks[p.id]==false ? 'Cannot share when locked' : 'Share'}`}
                  disabled={!pageLocks[p.id]}
                >
                  <span className="material-icons">share</span>
                </button>
                <button
                  className="mt-2 px-2 py-3 rounded-lg bg-red-500 hover:bg-red-600 text-white"
                  onClick={() => handleDelete(p.id)}
                  title="Delete"
                >
                  <span className="material-icons">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MainPage;
