/** Promptfoo custom provider backed by one owned DSH SDK runtime per sample. */

import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

function optionalString(config, key) {
  const value = config[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} must be a non-empty string`)
  return value
}

function positiveInteger(config, key) {
  const value = config[key]
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`)
  return value
}

function stringArray(config, key) {
  const value = config[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${key} must be an array of non-empty strings`)
  }
  return value
}

function harnessOptions(config) {
  const dshHome = optionalString(config, 'dshHome') ?? process.env.DSH_EVAL_HOME
  if (dshHome === undefined || dshHome.trim() === '') {
    throw new Error('dshHome or DSH_EVAL_HOME is required for an isolated evaluation home')
  }
  const options = { dshHome }
  for (const key of ['profile', 'provider', 'model', 'cwd', 'dshBin']) {
    const value = optionalString(config, key)
    if (value !== undefined) options[key] = value
  }
  const patches = stringArray(config, 'patches')
  if (patches !== undefined) options.patches = patches
  for (const key of ['maxTokens', 'requestTimeoutMs']) {
    const value = positiveInteger(config, key)
    if (value !== undefined) options[key] = value
  }
  return options
}

function turnEndReason(result) {
  for (let index = result.events.length - 1; index >= 0; index -= 1) {
    const event = result.events[index]
    if (event?.type === 'turn/end') return event.data.reason.kind
  }
  return undefined
}

async function runAndClose(harness, prompt) {
  let result
  let runError
  try {
    result = await harness.run(prompt)
  } catch (error) {
    runError = error
  }
  try {
    await harness.close()
  } catch (closeError) {
    if (runError !== undefined) {
      throw new AggregateError([runError, closeError], 'DSH evaluation run and cleanup failed')
    }
    throw closeError
  }
  if (runError !== undefined) throw runError
  if (result === undefined) throw new Error('DSH evaluation run returned no result')
  return result
}

/** Promptfoo provider that maps one rendered prompt to one fresh DSH session. */
export default class DshPromptfooProvider {
  constructor(
    providerOptions = {},
    createHarness = options => new DeepSeekHarness(options),
  ) {
    this.providerId = providerOptions.id ?? 'dsh-sdk'
    this.options = harnessOptions(providerOptions.config ?? {})
    this.createHarness = createHarness
  }

  id() {
    return this.providerId
  }

  async callApi(prompt, _context, callOptions) {
    if (callOptions?.abortSignal?.aborted) return { error: 'Promptfoo aborted before DSH evaluation launch' }
    try {
      const result = await runAndClose(this.createHarness(this.options), prompt)
      return {
        output: result.finalResponse,
        metadata: {
          dshSessionId: result.sessionId,
          dshEventCount: result.events.length,
          dshTurnEndReason: turnEndReason(result),
        },
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
}
