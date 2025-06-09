// src/pages/MainPage.tsx
import React, { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModal } from '../components/ModalContext';
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
  error:string|null,
  setError: (error: string | null) => void;
  user: unknown; // Replace with actual user type
}

const MainPage: React.FC<MainPageProps> = ({ pages, addPage, theme, deletePage,setError, user }) => {
  const [type, setType] = useState<PageDef['type']>('problem');
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const { globalModalOpen } = useModal();

  const handleSubmit = (e: FormEvent) => {
    if(!user){
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
              <button className={`col-span-1 rounded-lg bg-red-500 hover:bg-red-600 cursor-pointer ${globalModalOpen ? "blur-2xl" : ""}`} onClick={() => handleDelete(p.id)}><span className="material-icons">delete</span></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MainPage;
