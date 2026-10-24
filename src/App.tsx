import { useCallback, useEffect, useState } from 'react'
import type { PaperMeta } from '@shared/types'
import { api } from '@/lib/api'
import { LibraryView } from '@/features/library/LibraryView'
import { ReaderView } from '@/features/reader/ReaderView'
import { SettingsDialog } from '@/components/SettingsDialog'

type Theme = 'light' | 'dark'

export function App() {
  const [papers, setPapers] = useState<PaperMeta[]>([])
  const [open, setOpen] = useState<PaperMeta | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [providerReady, setProviderReady] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    // Browser storage can throw in a private window, and a reader should
    // still open if it does.
    try {
      const saved = localStorage.getItem('doculoom:theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch {
      // fall through to the system preference
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const refreshPapers = useCallback(() => {
    void api.listPapers().then(setPapers)
  }, [])

  const refreshProviders = useCallback(() => {
    void api.getProviders().then(({ active, providers }) => {
      setProviderReady(providers.some((p) => p.id === active && p.configured))
    })
  }, [])

  useEffect(() => {
    refreshPapers()
    refreshProviders()
  }, [refreshPapers, refreshProviders])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('doculoom:theme', theme)
    } catch {
      // Remembering the theme is a convenience, never a requirement.
    }
  }, [theme])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Mark />
          DocuLoom
        </div>
        {open ? (
          <>
            <button className="btn btn--quiet" onClick={() => setOpen(null)}>
              ← Shelf
            </button>
            <span className="topbar__title" title={open.title}>
              {open.title}
            </span>
          </>
        ) : null}
        <span className="spacer" />
        <button
          className="btn btn--quiet"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to day' : 'Switch to night'}
        >
          {theme === 'dark' ? 'Day' : 'Night'}
        </button>
        <button className="btn btn--quiet" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      {open ? (
        <ReaderView
          paper={open}
          providerReady={providerReady}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <LibraryView papers={papers} onOpen={setOpen} onChanged={refreshPapers} />
        </div>
      )}

      {settingsOpen ? (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onChanged={refreshProviders}
        />
      ) : null}
    </div>
  )
}

/** Four rules at four weights: the zoom ladder, drawn. */
function Mark() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true">
      <rect x="1" y="2" width="15" height="2.4" rx="1.2" fill="var(--accent)" />
      <rect x="1" y="6.6" width="11" height="2" rx="1" fill="var(--ink-2)" />
      <rect x="1" y="10.6" width="14" height="1.5" rx="0.75" fill="var(--ink-3)" />
      <rect x="1" y="13.8" width="8" height="1.3" rx="0.65" fill="var(--rule-strong)" />
    </svg>
  )
}
