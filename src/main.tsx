import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme } from './theme'
import { loadLocalTheme } from './screens/Settings'
import './styles.css'

// Тема до первой отрисовки — без вспышки чужих цветов.
const t = loadLocalTheme()
applyTheme(t.palette, t.mode)

const root = createRoot(document.getElementById('root')!)
// App тянет за собой клиент Supabase; без настроек показываем понятный текст, а не пустую страницу.
import('./App').then(
  ({ App }) => root.render(<StrictMode><App /></StrictMode>),
  (e) => root.render(<p className="center">Сайт открылся, но база не подключена: {String(e.message)}</p>),
)
