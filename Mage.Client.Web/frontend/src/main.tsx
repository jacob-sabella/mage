import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PrefsProvider } from './prefs'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PrefsProvider>
        <App />
      </PrefsProvider>
    </ErrorBoundary>
  </StrictMode>,
)
