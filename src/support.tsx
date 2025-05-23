import App from './App.tsx'
import { ModalProvider } from './components/ModalContext';

export default function Support(){
    return (
        <ModalProvider><App /></ModalProvider>
    )
}

