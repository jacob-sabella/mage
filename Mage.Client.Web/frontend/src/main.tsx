import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PrefsProvider } from './prefs'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </StrictMode>,
)
