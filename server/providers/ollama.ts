/**
 * Local provider: Ollama.
 *
 * Nothing leaves the machine. Quality depends heavily on the chosen model;
 * the pipeline validates and repairs output the same way for every provider.
 */
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type Provider,
  type ProviderStatus,
} from './types.js'

const DEFAULT_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b-instruct'

export class OllamaProvider implements Provider {
  readonly id = 'ollama'
  readonly label = 'Ollama (local)'
  readonly local = true

  constructor(
    readonly model: string = DEFAULT_MODEL,
    private readonly host: string = DEFAULT_HOST,
  ) {}

  async status(): Promise<ProviderStatus> {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { models?: { name: string }[] }
      const names = (body.models ?? []).map((m) => m.name)
      const present = names.some((n) => n === this.model || n.startsWith(`${this.model}:`))
      return {
        id: this.id,
        label: this.label,
        model: this.model,
        local: true,
        configured: present,
        detail: present
          ? 'Runs on this machine. No paper text leaves the device.'
          : `Ollama is running but ${this.model} is not pulled.`,
      }
    } catch {
      return {
        id: this.id,
        label: this.label,
        model: this.model,
        local: true,
        configured: false,
        detail: `No Ollama server at ${this.host}.`,
      }
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    let res: Response
    try {
      res = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: req.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          // Ollama accepts a JSON schema here and constrains decoding to it.
          format: req.schema ?? undefined,
          options: { num_predict: req.maxTokens },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
        }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('Analysis cancelled.', false)
      }
      throw new ProviderError(`Could not reach Ollama at ${this.host}.`, true)
    }

    if (!res.ok) {
      throw new ProviderError(
        `Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`,
        res.status >= 500,
      )
    }

    const body = (await res.json()) as {
      message?: { content?: string }
      prompt_eval_count?: number
      eval_count?: number
    }
    const text = body.message?.content ?? ''
    if (!text.trim()) throw new ProviderError('Ollama returned an empty response.', true)

    return {
      text,
      model: this.model,
      usage: {
        inputTokens: body.prompt_eval_count ?? 0,
        outputTokens: body.eval_count ?? 0,
      },
    }
  }
}
