/** Keyless execution test for the repository's Promptfoo provider example. */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createProcessDeepSeekHarness } from '../src/api.ts'
import type { RuntimeProcessOptions } from '../src/launch.ts'
import type { DeepSeekHarnessOptions, RunResult } from '../src/types.ts'

const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))
const providerUrl = new URL('../examples/promptfoo-provider.mjs', import.meta.url).href

interface ProviderResponse {
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

interface ProviderInstance {
  id(): string
  callApi(prompt: string, context?: unknown, options?: { abortSignal?: AbortSignal }): Promise<ProviderResponse>
}

interface EvalHarness {
  run(prompt: string): Promise<RunResult>
  close(): Promise<void>
}

type ProviderConstructor = new (
  options?: { id?: string; config?: Record<string, unknown> },
  factory?: (options: DeepSeekHarnessOptions) => EvalHarness,
) => ProviderInstance

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function providerClass(): Promise<ProviderConstructor> {
  const loaded: unknown = await import(providerUrl)
  if (!isRecord(loaded) || typeof loaded.default !== 'function') {
    throw new Error('Promptfoo provider example has no default class export')
  }
  return loaded.default as ProviderConstructor
}

function fakeLaunch(): RuntimeProcessOptions {
  return {
    command: process.execPath,
    args: [fakeRuntime],
    environment: () => ({ ...process.env, FAKE_TEXT: 'evaluation answer' }),
    description: 'Promptfoo provider fake runtime',
    initializeTimeoutMs: 5_000,
  }
}

describe('Promptfoo DSH provider example', () => {
  it('runs one sample through the real SDK protocol and returns receipt metadata', async () => {
    const DshPromptfooProvider = await providerClass()
    const provider = new DshPromptfooProvider({
      id: 'dsh-eval',
      config: {
        dshHome: '/unused-by-fixture',
        provider: 'fixture',
        model: 'fixture',
        maxTokens: 128,
      },
    }, (options: DeepSeekHarnessOptions) => createProcessDeepSeekHarness(fakeLaunch(), options))

    const response = await provider.callApi('evaluate this')

    expect(provider.id()).toBe('dsh-eval')
    expect(response.output).toBe('evaluation answer')
    expect(response.error).toBeUndefined()
    expect(response.metadata).toMatchObject({
      dshEventCount: 5,
      dshTurnEndReason: 'completed',
    })
    expect(response.metadata?.dshSessionId).toMatch(/^session-/)
  })

  it('requires an explicit evaluation home before constructing a runtime', async () => {
    const DshPromptfooProvider = await providerClass()
    const original = process.env.DSH_EVAL_HOME
    delete process.env.DSH_EVAL_HOME
    try {
      expect(() => new DshPromptfooProvider()).toThrow('dshHome or DSH_EVAL_HOME is required')
    } finally {
      if (original === undefined) delete process.env.DSH_EVAL_HOME
      else process.env.DSH_EVAL_HOME = original
    }
  })

  it('does not launch when Promptfoo has already cancelled the sample', async () => {
    const DshPromptfooProvider = await providerClass()
    let launches = 0
    const provider = new DshPromptfooProvider({ config: { dshHome: '/unused' } }, () => {
      launches += 1
      throw new Error('must not launch')
    })
    const controller = new AbortController()
    controller.abort()

    await expect(provider.callApi('cancelled', undefined, { abortSignal: controller.signal }))
      .resolves.toEqual({ error: 'Promptfoo aborted before DSH evaluation launch' })
    expect(launches).toBe(0)
  })
})
