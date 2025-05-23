import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import Support from './support.tsx';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Support/>
  </StrictMode>,
)
