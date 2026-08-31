/** Temporal Activity adapter backed by one owned DSH SDK runtime per attempt. */

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
  const dshHome = optionalString(config, 'dshHome') ?? process.env.DSH_TEMPORAL_HOME
  if (dshHome === undefined || dshHome.trim() === '') {
    throw new Error('dshHome or DSH_TEMPORAL_HOME is required for an isolated Temporal worker home')
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

function promptFromInput(input) {
  if (typeof input !== 'object' || input === null || typeof input.prompt !== 'string' || input.prompt.trim() === '') {
    throw new Error('runDshTask input.prompt must be a non-empty string')
  }
  return input.prompt
}

function turnEndReason(result) {
  for (let index = result.events.length - 1; index >= 0; index -= 1) {
    const event = result.events[index]
    if (event?.type === 'turn/end') return event.data.reason.kind
  }
  return undefined
}

function cancellationReason(signal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Temporal cancelled the DSH activity')
}

async function temporalActivityContext() {
  const { Context } = await import('@temporalio/activity')
  const context = Context.current()
  return {
    signal: context.cancellationSignal,
    heartbeat: details => context.heartbeat(details),
  }
}

/**
 * Create Temporal Activities for one worker deployment.
 *
 * The workflow must set `retry.maximumAttempts` to `1` unless duplicate model
 * calls and tool side effects are explicitly safe for that task.
 */
export function createDshTemporalActivities(
  config = {},
  createHarness = options => new DeepSeekHarness(options),
  getActivityContext = temporalActivityContext,
) {
  const options = harnessOptions(config)
  const heartbeatIntervalMs = positiveInteger(config, 'heartbeatIntervalMs') ?? 10_000

  return {
    async runDshTask(input) {
      const prompt = promptFromInput(input)
      const activity = await getActivityContext()
      if (activity.signal.aborted) throw cancellationReason(activity.signal)
      activity.heartbeat({ phase: 'starting' })
      if (activity.signal.aborted) throw cancellationReason(activity.signal)

      const harness = createHarness(options)
      let closePromise
      const close = () => closePromise ??= harness.close()
      const onAbort = () => { void close() }
      activity.signal.addEventListener('abort', onAbort, { once: true })
      if (activity.signal.aborted) onAbort()
      const heartbeat = setInterval(() => {
        try {
          activity.heartbeat({ phase: 'running' })
        } catch {
          void close()
        }
      }, heartbeatIntervalMs)

      let result
      let runError
      try {
        result = await harness.run(prompt)
      } catch (error) {
        runError = activity.signal.aborted ? cancellationReason(activity.signal) : error
      } finally {
        clearInterval(heartbeat)
        activity.signal.removeEventListener('abort', onAbort)
      }

      let closeError
      try {
        await close()
      } catch (error) {
        closeError = error
      }
      if (runError !== undefined && closeError !== undefined) {
        throw new AggregateError([runError, closeError], 'DSH Temporal activity and cleanup failed')
      }
      if (runError !== undefined) throw runError
      if (closeError !== undefined) throw closeError
      if (activity.signal.aborted) throw cancellationReason(activity.signal)
      if (result === undefined) throw new Error('DSH Temporal activity returned no result')

      return {
        finalResponse: result.finalResponse,
        receipt: {
          sessionId: result.sessionId,
          eventCount: result.events.length,
          turnEndReason: turnEndReason(result),
        },
      }
    },
  }
}
