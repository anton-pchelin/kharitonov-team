import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme } from './theme'
import { loadLocalTheme } from './screens/Settings'
import './styles.css'

// Тема до первой отрисовки — без вспышки чужих цветов.
const t = loadLocalTheme()
applyTheme(t.palette, t.mode)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
