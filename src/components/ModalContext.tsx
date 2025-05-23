// ModalContext.tsx
import React, { createContext, useContext, useState, type ReactNode } from 'react';

interface ModalContextType {
  globalModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const ModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [globalModalOpen, setGlobalModalOpen] = useState(false);

  const openModal = () => setGlobalModalOpen(true);
  const closeModal = () => setGlobalModalOpen(false);

  return (
    <ModalContext.Provider value={{ globalModalOpen, openModal, closeModal }}>
      {children}
    </ModalContext.Provider>
  );
};

export const useModal = (): ModalContextType => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};
