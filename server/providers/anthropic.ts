/**
 * Hosted provider: the Claude API.
 *
 * Paper text leaves the machine when this provider is selected, which the UI
 * states before the first analysis run.
 */
import Anthropic from '@anthropic-ai/sdk'
import { readKey } from './keystore.js'
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type Provider,
  type ProviderStatus,
} from './types.js'

const DEFAULT_MODEL = 'claude-opus-5-5'

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic'
  readonly label = 'Claude API'
  readonly local = false

  constructor(readonly model: string = DEFAULT_MODEL) {}

  private async client(): Promise<Anthropic> {
    const apiKey = await readKey('anthropic', 'ANTHROPIC_API_KEY')
    if (!apiKey) {
      throw new ProviderError(
        'No Claude API key configured. Add one in Settings, or set ANTHROPIC_API_KEY.',
        false,
      )
    }
    return new Anthropic({ apiKey })
  }

  async status(): Promise<ProviderStatus> {
    const apiKey = await readKey('anthropic', 'ANTHROPIC_API_KEY')
    return {
      id: this.id,
      label: this.label,
      model: this.model,
      local: false,
      configured: Boolean(apiKey),
      detail: apiKey
        ? 'Paper text is sent to the Claude API when this provider runs.'
        : 'Needs an API key.',
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const client = await this.client()
    try {
      // Streaming keeps long analyses from hitting the request timeout.
      const stream = client.messages.stream(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.prompt }],
          output_config: {
            effort: req.effort ?? 'high',
            ...(req.schema ? { format: { type: 'json_schema', schema: req.schema } } : {}),
          },
        },
        { signal: req.signal },
      )
      const message = await stream.finalMessage()

      if (message.stop_reason === 'refusal') {
        throw new ProviderError('The model declined to analyse this document.', false)
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')

      if (!text.trim()) {
        throw new ProviderError('The model returned an empty response.', true)
      }

      return {
        text,
        model: message.model,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      }
    } catch (error) {
      throw toProviderError(error)
    }
  }
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError('Rate limited by the Claude API. Try again shortly.', true)
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError('The Claude API rejected the configured key.', false)
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Could not reach the Claude API.', true)
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(`Claude API error ${error.status}: ${error.message}`, false)
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderError('Analysis cancelled.', false)
  }
  return new ProviderError(error instanceof Error ? error.message : String(error), false)
}
