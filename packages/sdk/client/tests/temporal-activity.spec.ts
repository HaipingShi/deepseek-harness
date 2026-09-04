/** Keyless execution tests for the repository's Temporal Activity example. */

import { readFileSync } from 'node:fs'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { DeepSeekHarnessOptions, RunResult } from '../src/types.ts'

const activityUrl = new URL('../examples/temporal-activity.mjs', import.meta.url).href
const workflowUrl = new URL('../examples/temporal-workflow.mjs', import.meta.url)
const workerUrl = new URL('../examples/temporal-worker.mjs', import.meta.url)

interface ActivityInput {
  prompt: string
}

interface ActivityOutput {
  finalResponse: string
  receipt: {
    sessionId: string
    eventCount: number
    turnEndReason?: string
  }
}

interface ActivityContext {
  signal: AbortSignal
  heartbeat(details: unknown): void
}

interface HarnessLike {
  run(prompt: string): Promise<RunResult>
  close(): Promise<void>
}

type ActivityFactory = (
  config?: Record<string, unknown>,
  createHarness?: (options: DeepSeekHarnessOptions) => HarnessLike,
  getActivityContext?: () => Promise<ActivityContext>,
) => { runDshTask(input: ActivityInput): Promise<ActivityOutput> }

async function activityFactory(): Promise<ActivityFactory> {
  const loaded: unknown = await import(activityUrl)
  if (typeof loaded !== 'object' || loaded === null || typeof (loaded as Record<string, unknown>).createDshTemporalActivities !== 'function') {
    throw new Error('Temporal activity example has no createDshTemporalActivities export')
  }
  return (loaded as { createDshTemporalActivities: ActivityFactory }).createDshTemporalActivities
}

function completedResult(): RunResult {
  return {
    sessionId: 'session-temporal-receipt',
    finalResponse: 'durable answer',
    notifications: [],
    events: [
      {
        type: 'turn/end',
        seq: SessionSeq(0),
        time: 1,
        data: { turn: 1, reason: { kind: 'completed' } },
      },
    ],
  }
}

describe('Temporal DSH activity example', () => {
  it('pins the reviewed SDK and disables automatic Activity retries', () => {
    const workflow = readFileSync(workflowUrl, 'utf8')
    const worker = readFileSync(workerUrl, 'utf8')

    expect(workflow.split('\n', 1)[0]).toContain('Temporal 1.23.0')
    expect(worker.split('\n', 1)[0]).toContain('Temporal 1.23.0')
    expect(workflow).toContain('retry: { maximumAttempts: 1 }')
    expect(workflow).toContain("heartbeatTimeout: '30 seconds'")
    expect(worker).toContain('createDshTemporalActivities()')
    expect(worker).toContain('DSH_TEMPORAL_TASK_QUEUE is required')
  })

  it('returns a DSH receipt, heartbeats, and closes its owned runtime', async () => {
    const createActivities = await activityFactory()
    const heartbeat = vi.fn()
    const close = vi.fn(async () => {})
    const run = vi.fn(async () => completedResult())
    const activities = createActivities(
      { dshHome: '/isolated-temporal-home' },
      (options) => {
        expect(options.dshHome).toBe('/isolated-temporal-home')
        return { run, close }
      },
      async () => ({ signal: new AbortController().signal, heartbeat }),
    )

    await expect(activities.runDshTask({ prompt: 'do durable work' })).resolves.toEqual({
      finalResponse: 'durable answer',
      receipt: {
        sessionId: 'session-temporal-receipt',
        eventCount: 1,
        turnEndReason: 'completed',
      },
    })
    expect(run).toHaveBeenCalledWith('do durable work')
    expect(heartbeat).toHaveBeenCalledWith({ phase: 'starting' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('requires an isolated worker home and a non-empty prompt', async () => {
    const createActivities = await activityFactory()
    const original = process.env.DSH_TEMPORAL_HOME
    delete process.env.DSH_TEMPORAL_HOME
    try {
      expect(() => createActivities()).toThrow('dshHome or DSH_TEMPORAL_HOME is required')
    } finally {
      if (original === undefined) delete process.env.DSH_TEMPORAL_HOME
      else process.env.DSH_TEMPORAL_HOME = original
    }

    const activities = createActivities({ dshHome: '/isolated' })
    await expect(activities.runDshTask({ prompt: '   ' })).rejects.toThrow('input.prompt must be a non-empty string')
  })

  it('does not create a runtime when Temporal cancelled before launch', async () => {
    const createActivities = await activityFactory()
    const controller = new AbortController()
    controller.abort(new Error('cancelled by workflow'))
    let launches = 0
    const activities = createActivities(
      { dshHome: '/isolated' },
      () => {
        launches += 1
        throw new Error('must not launch')
      },
      async () => ({ signal: controller.signal, heartbeat: () => {} }),
    )

    await expect(activities.runDshTask({ prompt: 'do not run' })).rejects.toThrow('cancelled by workflow')
    expect(launches).toBe(0)
  })

  it('closes the runtime when Temporal cancels an active task', async () => {
    const createActivities = await activityFactory()
    const controller = new AbortController()
    let rejectRun: (error: Error) => void = () => {}
    const run = new Promise<RunResult>((_resolve, reject) => { rejectRun = reject })
    const close = vi.fn(async () => { rejectRun(new Error('runtime closed')) })
    let announceLaunch: () => void = () => {}
    const launched = new Promise<void>((resolve) => { announceLaunch = resolve })
    const activities = createActivities(
      { dshHome: '/isolated' },
      () => {
        announceLaunch()
        return { run: async () => await run, close }
      },
      async () => ({ signal: controller.signal, heartbeat: () => {} }),
    )

    const pending = activities.runDshTask({ prompt: 'cancel me' })
    await launched
    controller.abort(new Error('workflow cancellation'))

    await expect(pending).rejects.toThrow('workflow cancellation')
    expect(close).toHaveBeenCalledOnce()
  })
})
