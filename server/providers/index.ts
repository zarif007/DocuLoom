/** Provider registry. One hosted, one local, both behind the same interface. */
import { getSetting, setSetting } from '../db/repo.js'
import { AnthropicProvider } from './anthropic.js'
import { OfflineProvider } from './offline.js'
import { OllamaProvider } from './ollama.js'
import type { Provider, ProviderStatus } from './types.js'

const providers: Provider[] = [
  new AnthropicProvider(),
  new OllamaProvider(),
  new OfflineProvider(),
]

export function listProviders(): Provider[] {
  return providers
}

export async function providerStatuses(): Promise<ProviderStatus[]> {
  return Promise.all(providers.map((p) => p.status()))
}

export function getProvider(id?: string): Provider {
  const wanted = id ?? getSetting('provider') ?? 'anthropic'
  const found = providers.find((p) => p.id === wanted)
  if (!found) throw new Error(`Unknown provider: ${wanted}`)
  return found
}

export function setActiveProvider(id: string) {
  if (!providers.some((p) => p.id === id)) throw new Error(`Unknown provider: ${id}`)
  setSetting('provider', id)
}

export * from './types.js'
