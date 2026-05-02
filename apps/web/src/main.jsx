import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ThemeProvider, ModalProvider } from '@shared/contexts'
import { AppErrorBoundary } from '@shared/components'
import { installFrontendTelemetryHandlers } from '@shared/lib'

installFrontendTelemetryHandlers()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <ThemeProvider>
        <ModalProvider>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </ModalProvider>
      </ThemeProvider>
    </HashRouter>
  </StrictMode>,
)
