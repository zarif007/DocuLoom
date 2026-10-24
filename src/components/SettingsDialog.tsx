import { useEffect, useState } from 'react'
import { api, type ProviderStatus } from '@/lib/api'

interface Props {
  onClose: () => void
  onChanged: () => void
}

/**
 * Provider choice and credentials.
 *
 * Keys are written to the OS credential store by the server and are never
 * read back into the UI, so this field is write-only by design.
 */
export function SettingsDialog({ onClose, onChanged }: Props) {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [active, setActive] = useState('anthropic')
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)

  const refresh = () =>
    api.getProviders().then((result) => {
      setProviders(result.providers)
      setActive(result.active)
    })

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>Model provider</h2>
        <p style={{ color: 'var(--ink-2)', marginTop: 0, fontSize: 13.5 }}>
          Reading runs on the provider you pick here. Everything else, including your
          papers and everything built from them, stays on this machine.
        </p>

        {providers.map((provider) => (
          <div
            className={`provider-row${provider.id === active ? ' provider-row--active' : ''}`}
            key={provider.id}
          >
            <input
              type="radio"
              name="provider"
              checked={provider.id === active}
              onChange={async () => {
                await api.setProvider(provider.id)
                setActive(provider.id)
                onChanged()
              }}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 550 }}>
                {provider.label}
                <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
                  {' '}
                  · {provider.model}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                {provider.detail}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  marginTop: 3,
                  color: provider.configured
                    ? 'var(--support-direct)'
                    : 'var(--support-inferred)',
                }}
              >
                {provider.configured ? 'Ready' : 'Not configured'}
                {provider.local ? ' · runs locally' : ' · sends paper text off this device'}
              </div>
            </div>
          </div>
        ))}

        <label className="field">
          <span>Claude API key (stored in your OS keychain, never shown again)</span>
          <input
            type="password"
            value={key}
            placeholder="sk-ant-…"
            onChange={(event) => {
              setKey(event.target.value)
              setSaved(false)
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn"
            disabled={!key.trim()}
            onClick={async () => {
              await api.setKey('anthropic', key.trim())
              setKey('')
              setSaved(true)
              await refresh()
              onChanged()
            }}
          >
            Save key
          </button>
          {saved ? <span style={{ fontSize: 12.5, color: 'var(--support-direct)' }}>Saved.</span> : null}
          <span className="spacer" />
          <button className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
