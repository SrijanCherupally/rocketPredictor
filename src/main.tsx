import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { ErrorBoundary } from './ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><Suspense fallback={<div className="page-loading" role="status">Loading apexFlite…</div>}><App /></Suspense></ErrorBoundary>
  </StrictMode>,
)
