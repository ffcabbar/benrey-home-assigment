import Anthropic from '@anthropic-ai/sdk'

export const LLM_TIMEOUT_MS = 15_000
// Hard cap for the whole call, SDK retry included.
export const LLM_OVERALL_TIMEOUT_MS = 16_000
// Room for adaptive thinking; answer length is set in the system prompt.
export const LLM_MAX_TOKENS = 2_000

export type MessagesClient = { messages: Pick<Anthropic['messages'], 'create'> }

// The key is passed explicitly so the SDK never falls back to ANTHROPIC_AUTH_TOKEN or an `ant` profile.
export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: LLM_TIMEOUT_MS, maxRetries: 1 })
}

export class LLMUnavailableError extends Error {
  constructor(
    message: string,
    public readonly reason: 'timeout' | 'connection' | 'rate_limited' | 'server' | 'api' | 'empty',
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'LLMUnavailableError'
  }
}

export class LLMAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LLMAuthError'
  }
}

export type AssistantReply = { kind: 'answer'; text: string } | { kind: 'refusal' }

function mapSdkError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new LLMAuthError(`Anthropic rejected the API key (HTTP ${error.status})`)
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LLMUnavailableError('Anthropic rate limit', 'rate_limited', error.status)
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) {
    return new LLMUnavailableError('Anthropic request timed out', 'timeout')
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LLMUnavailableError('Could not reach Anthropic', 'connection')
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new LLMUnavailableError(`Anthropic server error (HTTP ${error.status})`, 'server', error.status)
  }
  if (error instanceof Anthropic.APIError) {
    return new LLMUnavailableError(`Anthropic API error (HTTP ${error.status ?? 'n/a'})`, 'api', error.status)
  }
  return error instanceof Error ? error : new Error(String(error))
}

export async function askClaude({
  client,
  model,
  system,
  question,
  overallTimeoutMs = LLM_OVERALL_TIMEOUT_MS,
}: {
  client: MessagesClient
  model: string
  system: string
  question: string
  overallTimeoutMs?: number
}): Promise<AssistantReply> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), overallTimeoutMs)
  let response: Anthropic.Message
  try {
    response = await client.messages.create(
      {
        model,
        max_tokens: LLM_MAX_TOKENS,
        // No prompt caching: a form context is below the minimum cacheable prefix.
        system: system,
        // Thinking can't be disabled on this model; low effort keeps answers quick.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: question }],
      },
      { signal: controller.signal },
    )
  } catch (error) {
    throw mapSdkError(error)
  } finally {
    clearTimeout(timer)
  }

  if (response.stop_reason === 'refusal') return { kind: 'refusal' }

  const text = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim()
  if (!text) {
    throw new LLMUnavailableError(`Anthropic returned no text (stop_reason: ${response.stop_reason})`, 'empty')
  }
  return { kind: 'answer', text }
}
