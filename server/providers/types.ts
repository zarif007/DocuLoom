/**
 * Provider abstraction.
 *
 * Analysis asks for structured JSON and nothing else. Keeping the surface
 * this narrow is what makes a hosted model and a local one interchangeable,
 * and keeps generated content out of the execution path.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface GenerateRequest {
  system: string
  prompt: string
  maxTokens: number
  /** JSON Schema the response must satisfy, when the provider supports it. */
  schema?: Record<string, unknown>
  effort?: Effort
  signal?: AbortSignal
}

export interface GenerateResult {
  text: string
  model: string
  usage?: { inputTokens: number; outputTokens: number }
}

export interface ProviderStatus {
  id: string
  label: string
  model: string
  /** Whether paper text would leave this machine when the provider is used. */
  local: boolean
  configured: boolean
  detail: string
}

export interface Provider {
  readonly id: string
  readonly label: string
  readonly model: string
  readonly local: boolean
  status(): Promise<ProviderStatus>
  generate(req: GenerateRequest): Promise<GenerateResult>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
