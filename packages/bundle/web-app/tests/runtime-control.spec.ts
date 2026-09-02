/** DevBoard Runtime Protocol v1 client behavior. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import {
  createDevBoardRuntimeControl,
  type DevBoardRuntimeControl,
  type RuntimeControlWebSocketFactory,
} from '../src/runtime-control.ts'

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000'
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174001'
const GRANT = 'g'.repeat(43)
const HANDOFF_TOKEN = 'h'.repeat(43)

class FakeSocket extends EventTarget {
  readyState = 0
  readonly sent: string[] = []
  readonly closes: { code?: number; reason?: string }[] = []
  failSend = false

  open(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  message(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  fail(): void {
    this.dispatchEvent(new Event('error'))
  }

  disconnect(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  send(value: string): void {
    if (this.failSend) throw new Error('fake send failed')
    if (this.readyState !== 1) throw new Error('fake socket is not open')
    this.sent.push(value)
  }

  close(code?: number, reason?: string): void {
    this.closes.push({
      ...code === undefined ? {} : { code },
      ...reason === undefined ? {} : { reason },
    })
    this.disconnect()
  }
}

function managedEnvironment(overrides: Readonly<Record<string, string>> = {}) {
  return createLaunchEnvironmentSnapshot([{
    source: 'process',
    values: {
      DEVBOARD_CONTROL_URL: 'ws://127.0.0.1:7101/runtime-control/v1',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
      ...overrides,
    },
  }])
}

function harness(options: {
  createHandoffUrl?: () => string
  invalidateHandoffs?: () => void
} = {}): {
  control: DevBoardRuntimeControl
  socket: FakeSocket
  factory: ReturnType<typeof vi.fn<RuntimeControlWebSocketFactory>>
} {
  const socket = new FakeSocket()
  const factory = vi.fn<RuntimeControlWebSocketFactory>(() => socket as unknown as WebSocket)
  const control = createDevBoardRuntimeControl({
    environment: managedEnvironment(),
    port: 4567,
    createHandoffUrl: options.createHandoffUrl
      ?? (() => `http://127.0.0.1:4567/?token=${HANDOFF_TOKEN}`),
    invalidateHandoffs: options.invalidateHandoffs ?? (() => {}),
    webSocketFactory: factory,
  })
  if (control === undefined) throw new Error('managed fixture did not create a controller')
  return { control, socket, factory }
}

function sent(socket: FakeSocket): Record<string, unknown>[] {
  return socket.sent.map(frame => JSON.parse(frame) as Record<string, unknown>)
}

async function connect(control: DevBoardRuntimeControl, socket: FakeSocket): Promise<void> {
  const connecting = control.connect()
  socket.open()
  await connecting
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DevBoard runtime control environment', () => {
  it('preserves standalone behavior only when all three fields are absent', () => {
    const control = createDevBoardRuntimeControl({
      environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]),
      port: 4567,
      createHandoffUrl: () => '',
      invalidateHandoffs: () => {},
    })
    expect(control).toBeUndefined()
  })

  it.each([
    { DEVBOARD_CONTROL_URL: 'ws://127.0.0.1:7101/runtime-control/v1' },
    {
      DEVBOARD_CONTROL_URL: 'not a URL',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'http://127.0.0.1:7101/runtime-control/v1',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'ws://localhost:7101/runtime-control/v1',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'ws://127.0.0.1:7101/runtime-control/v1?grant=secret',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'ws://user@127.0.0.1:7101/runtime-control/v1',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'ws://:password@127.0.0.1:7101/runtime-control/v1',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'ws://127.0.0.1:7101/wrong',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'ws://127.0.0.1:7101/runtime-control/v1#fragment',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'ws://127.0.0.1:7101/runtime-control/v1',
      DEVBOARD_RUN_ID: RUN_ID.toUpperCase(),
      DEVBOARD_CONTROL_GRANT: GRANT,
    },
    {
      DEVBOARD_CONTROL_URL: 'ws://127.0.0.1:7101/runtime-control/v1',
      DEVBOARD_RUN_ID: RUN_ID,
      DEVBOARD_CONTROL_GRANT: 'short',
    },
  ])('fails closed for a partial or malformed process environment', (values) => {
    expect(() => createDevBoardRuntimeControl({
      environment: createLaunchEnvironmentSnapshot([{ source: 'process', values }]),
      port: 4567,
      createHandoffUrl: () => '',
      invalidateHandoffs: () => {},
    })).toThrow('ENV_INVALID')
  })

  it('rejects control fields sourced from discovered env files', () => {
    expect(() => createDevBoardRuntimeControl({
      environment: createLaunchEnvironmentSnapshot([{
        source: 'project-env',
        path: '/work/.env',
        values: {
          DEVBOARD_CONTROL_URL: 'ws://127.0.0.1:7101/runtime-control/v1',
          DEVBOARD_RUN_ID: RUN_ID,
          DEVBOARD_CONTROL_GRANT: GRANT,
        },
      }]),
      port: 4567,
      createHandoffUrl: () => '',
      invalidateHandoffs: () => {},
    })).toThrow('ENV_INVALID')
  })

  it.each([0, 65536, 1.5])('rejects invalid endpoint port %s', (port) => {
    expect(() => createDevBoardRuntimeControl({
      environment: managedEnvironment(),
      port,
      createHandoffUrl: () => '',
      invalidateHandoffs: () => {},
    })).toThrow('ENDPOINT_INVALID')
  })
})

describe('DevBoard runtime control lifecycle', () => {
  it('authenticates in headers and orders hello before ready', async () => {
    const { control, socket, factory } = harness()
    expect(() => control.markReady()).toThrow('STATE_INVALID')
    const connecting = control.connect()
    expect(factory).toHaveBeenCalledWith(
      'ws://127.0.0.1:7101/runtime-control/v1',
      {
        headers: {
          authorization: `Bearer ${GRANT}`,
          'x-devboard-run-id': RUN_ID,
        },
      },
    )
    expect(socket.sent).toEqual([])
    socket.open()
    await connecting
    expect(sent(socket)).toEqual([{
      protocol: 'devboard.runtime-control/v1',
      type: 'hello',
      runId: RUN_ID,
      manifestId: 'dsh-web',
      openMode: 'session-handoff',
    }])
    control.markReady()
    expect(sent(socket)[1]).toEqual({
      protocol: 'devboard.runtime-control/v1',
      type: 'ready',
      runId: RUN_ID,
      endpoint: { id: 'main', host: '127.0.0.1', port: 4567 },
      openMode: 'session-handoff',
    })
    expect(control.getState()).toEqual({
      protocol: 'devboard.runtime-control/v1',
      phase: 'READY',
      openMode: 'session-handoff',
    })
    expect(control.getState()).not.toHaveProperty('grant')
  })

  it('uses the platform WebSocket constructor when no test transport is supplied', async () => {
    const created: FakeSocket[] = []
    let address: string | URL | undefined
    let options: WebSocketInit | undefined
    class PlatformSocket extends FakeSocket {
      constructor(url: string | URL, init: WebSocketInit) {
        super()
        created.push(this)
        address = url
        options = init
      }
    }
    vi.stubGlobal('WebSocket', PlatformSocket)
    const control = createDevBoardRuntimeControl({
      environment: managedEnvironment(),
      port: 4567,
      createHandoffUrl: () => `http://127.0.0.1:4567/?token=${HANDOFF_TOKEN}`,
      invalidateHandoffs: () => {},
    })
    if (control === undefined) throw new Error('managed fixture did not create a controller')
    const connecting = control.connect()
    created[0]?.open()
    await connecting
    expect(address).toBe('ws://127.0.0.1:7101/runtime-control/v1')
    expect(options).toEqual({
      headers: {
        authorization: `Bearer ${GRANT}`,
        'x-devboard-run-id': RUN_ID,
      },
    })
  })

  it('rejects repeated connect and constructor failures without exposing credentials', async () => {
    const first = harness()
    await connect(first.control, first.socket)
    await expect(first.control.connect()).rejects.toThrow('STATE_INVALID')

    const invalidateHandoffs = vi.fn()
    const factory = vi.fn<RuntimeControlWebSocketFactory>(() => { throw new Error(`private ${GRANT}`) })
    const failed = createDevBoardRuntimeControl({
      environment: managedEnvironment(),
      port: 4567,
      createHandoffUrl: () => '',
      invalidateHandoffs,
      webSocketFactory: factory,
    })
    if (failed === undefined) throw new Error('managed fixture did not create a controller')
    await expect(failed.connect()).rejects.toThrow('CONNECT_FAILED')
    expect(invalidateHandoffs).toHaveBeenCalled()
  })

  it('closes when hello or ready cannot be sent', async () => {
    const hello = harness()
    const helloConnecting = hello.control.connect()
    const helloRejected = expect(helloConnecting).rejects.toThrow('SEND_FAILED')
    hello.socket.failSend = true
    hello.socket.open()
    await helloRejected
    expect(hello.socket.closes).toContainEqual({ code: 1011, reason: 'control send failed' })

    const ready = harness()
    await connect(ready.control, ready.socket)
    ready.socket.failSend = true
    expect(() => ready.control.markReady()).toThrow('SEND_FAILED')
    expect(ready.socket.closes).toContainEqual({ code: 1011, reason: 'control send failed' })

    const closing = harness()
    await connect(closing.control, closing.socket)
    closing.socket.readyState = 2
    expect(() => closing.control.markReady()).toThrow('SEND_FAILED')
  })

  it('correlates a valid open request with a schema-exact available response', async () => {
    const createHandoffUrl = vi.fn(() => `http://127.0.0.1:4567/?token=${HANDOFF_TOKEN}`)
    const { control, socket } = harness({ createHandoffUrl })
    await connect(control, socket)
    control.markReady()
    socket.message(JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
    }))
    expect(createHandoffUrl).toHaveBeenCalledTimes(1)
    expect(sent(socket)[2]).toEqual({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.response',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      status: 'available',
      handoffUrl: `http://127.0.0.1:4567/?token=${HANDOFF_TOKEN}`,
    })
  })

  it('returns a schema-exact unavailable response when capability creation fails', async () => {
    const invalidateHandoffs = vi.fn()
    const { control, socket } = harness({
      createHandoffUrl: () => { throw new Error('private capability failure') },
      invalidateHandoffs,
    })
    await connect(control, socket)
    control.markReady()
    socket.message(JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://127.0.0.1:7100',
    }))
    expect(sent(socket)[2]).toEqual({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.response',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      status: 'unavailable',
      code: 'OPEN_UNAVAILABLE',
    })
    expect(invalidateHandoffs).toHaveBeenCalledTimes(1)
  })

  it.each([
    '',
    'x'.repeat(2049),
    'not a URL',
    `https://127.0.0.1:4567/?token=${HANDOFF_TOKEN}`,
    `http://localhost:4567/?token=${HANDOFF_TOKEN}`,
    `http://127.0.0.1:4568/?token=${HANDOFF_TOKEN}`,
    `http://user@127.0.0.1:4567/?token=${HANDOFF_TOKEN}`,
    `http://:password@127.0.0.1:4567/?token=${HANDOFF_TOKEN}`,
    `http://127.0.0.1:4567/wrong?token=${HANDOFF_TOKEN}`,
    `http://127.0.0.1:4567/?token=${HANDOFF_TOKEN}#fragment`,
    `http://127.0.0.1:4567/?token=${HANDOFF_TOKEN}&extra=value`,
    `http://127.0.0.1:4567/?token=${HANDOFF_TOKEN}&token=${HANDOFF_TOKEN}`,
    'http://127.0.0.1:4567/?token=short',
  ])('returns unavailable instead of emitting an invalid handoff URL %#', async (handoffUrl) => {
    const { control, socket } = harness({ createHandoffUrl: () => handoffUrl })
    await connect(control, socket)
    control.markReady()
    socket.message(JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
    }))
    expect(sent(socket)[2]).toMatchObject({ status: 'unavailable', code: 'OPEN_UNAVAILABLE' })
  })

  it.each([
    ['primitive', JSON.stringify('open.request')],
    ['null', JSON.stringify(null)],
    ['array', JSON.stringify([])],
    ['wrong origin', JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://evil.example',
    })],
    ['wrong protocol', JSON.stringify({
      protocol: 'wrong',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
    })],
    ['wrong type', JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'other',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
    })],
    ['wrong run', JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: '123e4567-e89b-42d3-a456-426614174099',
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
    })],
    ['non-string request id', JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: 42,
      origin: 'http://localhost:7100',
    })],
    ['invalid request id', JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: 'UPPERCASE',
      origin: 'http://localhost:7100',
    })],
    ['non-string origin', JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 42,
    })],
    ['unknown field', JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
      extra: true,
    })],
    ['invalid JSON', '{'],
    ['oversized frame', 'x'.repeat(4097)],
    ['binary frame', new Uint8Array([1, 2, 3])],
  ])('closes and revokes on %s', async (_label, frame) => {
    const invalidateHandoffs = vi.fn()
    const { control, socket } = harness({ invalidateHandoffs })
    await connect(control, socket)
    control.markReady()
    socket.message(frame)
    expect(socket.closes).toContainEqual({ code: 1008, reason: 'invalid control request' })
    expect(invalidateHandoffs).toHaveBeenCalled()
    expect(control.getState().phase).toBe('CLOSED')
  })

  it('rejects an open request before ready', async () => {
    const invalidateHandoffs = vi.fn()
    const { control, socket } = harness({ invalidateHandoffs })
    await connect(control, socket)
    socket.message(JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
    }))
    expect(socket.closes).toContainEqual({ code: 1008, reason: 'invalid control request' })
    expect(invalidateHandoffs).toHaveBeenCalled()
  })

  it('fails a rejected authenticated handshake and revokes capabilities', async () => {
    const invalidateHandoffs = vi.fn()
    const { control, socket } = harness({ invalidateHandoffs })
    const connecting = control.connect()
    const rejected = expect(connecting).rejects.toThrow('CONNECT_FAILED')
    socket.fail()
    await rejected
    socket.open()
    expect(socket.closes).toContainEqual({ code: 1011, reason: 'control connection failed' })
    expect(invalidateHandoffs).toHaveBeenCalled()
    expect(control.getState().phase).toBe('CLOSED')
  })

  it('revokes on disconnect and shutdown without logging either secret', async () => {
    const invalidateHandoffs = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { control, socket } = harness({ invalidateHandoffs })
    await connect(control, socket)
    control.markReady()
    socket.disconnect()
    expect(invalidateHandoffs).toHaveBeenCalled()
    expect(control.getState().phase).toBe('CLOSED')
    expect(JSON.stringify(sent(socket))).not.toContain(GRANT)
    expect(JSON.stringify(log.mock.calls)).not.toContain(GRANT)
    expect(JSON.stringify(error.mock.calls)).not.toContain(GRANT)
    expect(JSON.stringify(log.mock.calls)).not.toContain(HANDOFF_TOKEN)
    expect(JSON.stringify(error.mock.calls)).not.toContain(HANDOFF_TOKEN)

    const second = harness({ invalidateHandoffs })
    await connect(second.control, second.socket)
    await second.control.close()
    expect(second.socket.closes).toContainEqual({ code: 1000, reason: 'runtime shutdown' })

    const neverConnected = harness({ invalidateHandoffs })
    await neverConnected.control.close()
    const alreadyClosed = harness({ invalidateHandoffs })
    await connect(alreadyClosed.control, alreadyClosed.socket)
    alreadyClosed.socket.disconnect()
    await alreadyClosed.control.close()

    const closing = harness({ invalidateHandoffs })
    await connect(closing.control, closing.socket)
    closing.socket.readyState = 2
    const close = closing.control.close()
    closing.socket.disconnect()
    await close
  })

  it('closes if an available or unavailable response cannot be sent', async () => {
    const available = harness()
    await connect(available.control, available.socket)
    available.control.markReady()
    available.socket.failSend = true
    available.socket.message(JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
    }))
    expect(available.socket.closes).toContainEqual({ code: 1011, reason: 'control send failed' })

    const unavailable = harness({ createHandoffUrl: () => '' })
    await connect(unavailable.control, unavailable.socket)
    unavailable.control.markReady()
    unavailable.socket.failSend = true
    unavailable.socket.message(JSON.stringify({
      protocol: 'devboard.runtime-control/v1',
      type: 'open.request',
      runId: RUN_ID,
      requestId: REQUEST_ID,
      origin: 'http://localhost:7100',
    }))
    expect(unavailable.socket.closes).toContainEqual({ code: 1011, reason: 'control send failed' })
  })
})
