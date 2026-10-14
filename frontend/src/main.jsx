import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import './styles/tokens.css'
import './index.css'
import './styles/components.css'
import App from './App.jsx'
import { ThemeProvider } from './theme/ThemeProvider'
import { ToastProvider } from './components/common/Toast'
import { ConfirmProvider } from './components/common/ConfirmProvider'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
