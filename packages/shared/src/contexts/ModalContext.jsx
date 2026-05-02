import { createContext, useContext, useState, useCallback } from 'react';

const ModalContext = createContext();

export function ModalProvider({ children }) {
  const [modals, setModals] = useState([]);

  const openModal = useCallback((type, data = {}) => {
    setModals(prev => [...prev, { type, data, id: Date.now() }]);
  }, []);

  const closeModal = useCallback((id = null) => {
    setModals(prev => {
      if (id === null) {
        // Close last modal
        return prev.slice(0, -1);
      }
      // Close specific modal
      return prev.filter(m => m.id !== id);
    });
  }, []);

  const closeAll = useCallback(() => {
    setModals([]);
  }, []);

  return (
    <ModalContext.Provider value={{ modals, openModal, closeModal, closeAll }}>
      {children}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within ModalProvider');
  }
  return context;
}
