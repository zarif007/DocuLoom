import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Fonts are bundled, not fetched. A local-first reader should not call a CDN
// to render a document that is already on the machine.
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/instrument-sans'
import '@fontsource/ibm-plex-mono/400.css'

import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
