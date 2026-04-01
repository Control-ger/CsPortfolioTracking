import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext'
import { ModalProvider } from './ModalContext'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installFrontendTelemetryHandlers } from './lib/frontendTelemetry'

installFrontendTelemetryHandlers()

createRoot(document.getElementById('***REMOVED***')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ModalProvider>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </ModalProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
