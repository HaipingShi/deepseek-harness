/** DevBoard Runtime Protocol v1 client for the managed Web application. */

import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const PROTOCOL = 'devboard.runtime-control/v1' as const
const CONTROL_PATH = '/runtime-control/v1'
const MANIFEST_ID = 'dsh-web' as const
const OPEN_MODE = 'session-handoff' as const
const ENDPOINT_ID = 'main' as const
const LOOPBACK_HOST = '127.0.0.1' as const
const MAX_FRAME_BYTES = 4096
const MAX_HANDOFF_URL_LENGTH = 2048
const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1
const SOCKET_CLOSING = 2
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const GRANT_PATTERN = /^[A-Za-z0-9_-]{43}$/u
const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u
const OWNER_ORIGINS = new Set(['http://localhost:7100', 'http://127.0.0.1:7100'])
const CONTROL_ENV_NAMES = [
  'DEVBOARD_CONTROL_URL',
  'DEVBOARD_RUN_ID',
  'DEVBOARD_CONTROL_GRANT',
] as const

type ControlPhase = 'CREATED' | 'CONNECTING' | 'HELLO' | 'READY' | 'CLOSED'

interface ManagedEnvironment {
  readonly controlUrl: string
  readonly runId: string
  readonly grant: string
}

interface OpenRequest {
  readonly protocol: typeof PROTOCOL
  readonly type: 'open.request'
  readonly runId: string
  readonly requestId: string
  readonly origin: string
}

/** Public state excludes every control and browser capability. */
export interface RuntimeControlState {
  readonly protocol: typeof PROTOCOL
  readonly phase: ControlPhase
  readonly openMode: typeof OPEN_MODE
}

/** Construction inputs for one managed DSH Web runtime. */
export interface RuntimeControlOptions {
  /** Immutable process launch environment with source attribution. */
  readonly environment: LaunchEnvironmentSnapshot
  /** Bound loopback HTTP port announced after application readiness. */
  readonly port: number
  /** Mint one fresh browser capability after a valid open request. */
  readonly createHandoffUrl: () => string
  /** Revoke every unconsumed browser capability owned by this process. */
  readonly invalidateHandoffs: () => void
  /** Test seam for the platform WebSocket constructor. */
  readonly webSocketFactory?: RuntimeControlWebSocketFactory
}

/** Narrow constructor shape shared by Node's WebSocket and test transports. */
export type RuntimeControlWebSocketFactory = (
  url: string,
  init: WebSocketInit,
) => WebSocket

function runtimeControlError(code: string): Error {
  return Object.assign(new Error(`web-app: DevBoard runtime control failed (${code})`), { code })
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function resolveManagedEnvironment(
  environment: LaunchEnvironmentSnapshot,
): ManagedEnvironment | undefined {
  const visible = CONTROL_ENV_NAMES.map(name => environment.get(name))
  if (visible.every(entry => entry === undefined)) return undefined
  const inherited = CONTROL_ENV_NAMES.map(name => environment.getFrom(name, ['process']))
  if (inherited.some(entry => entry === undefined)
    || visible.some(entry => entry?.source !== 'process')) {
    throw runtimeControlError('ENV_INVALID')
  }
  const [controlEntry, runEntry, grantEntry] = inherited
  const controlUrl = controlEntry?.value
  const runId = runEntry?.value
  const grant = grantEntry?.value
  if (controlUrl === undefined || runId === undefined || grant === undefined
    || !UUID_PATTERN.test(runId) || !GRANT_PATTERN.test(grant)) {
    throw runtimeControlError('ENV_INVALID')
  }
  let url: URL
  try {
    url = new URL(controlUrl)
  } catch {
    throw runtimeControlError('ENV_INVALID')
  }
  if (url.protocol !== 'ws:'
    || url.hostname !== LOOPBACK_HOST
    || url.pathname !== CONTROL_PATH
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== '') {
    throw runtimeControlError('ENV_INVALID')
  }
  return { controlUrl: url.href, runId, grant }
}

function parseOpenRequest(value: unknown, runId: string): OpenRequest | undefined {
  const keys = ['protocol', 'type', 'runId', 'requestId', 'origin']
  if (!exactObject(value, keys)
    || value.protocol !== PROTOCOL
    || value.type !== 'open.request'
    || value.runId !== runId
    || typeof value.requestId !== 'string'
    || !UUID_PATTERN.test(value.requestId)
    || typeof value.origin !== 'string'
    || !OWNER_ORIGINS.has(value.origin)) return undefined
  return value as unknown as OpenRequest
}

function canonicalHandoffUrl(value: string, port: number): string | undefined {
  if (value.length === 0 || value.length > MAX_HANDOFF_URL_LENGTH) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  const tokens = url.searchParams.getAll('token')
  if (url.protocol !== 'http:'
    || url.hostname !== LOOPBACK_HOST
    || url.port !== String(port)
    || url.username !== ''
    || url.password !== ''
    || url.pathname !== '/'
    || url.hash !== ''
    || [...url.searchParams.keys()].some(name => name !== 'token')
    || tokens.length !== 1
    || !HANDOFF_TOKEN_PATTERN.test(tokens[0] as string)) return undefined
  return url.href
}

function platformWebSocketFactory(url: string, init: WebSocketInit): WebSocket {
  const NodeWebSocket = WebSocket as unknown as new (
    address: string,
    options: WebSocketInit,
  ) => WebSocket
  return new NodeWebSocket(url, init)
}

/**
 * One fail-closed managed control connection. Instances never reconnect.
 * Browser capabilities remain owned by Connection and are revoked on every
 * transport or lifecycle terminal path.
 */
export class DevBoardRuntimeControl {
  private phase: ControlPhase = 'CREATED'
  private socket: WebSocket | undefined
  private connectReject: ((error: Error) => void) | undefined
  private readonly closeWaiters = new Set<() => void>()

  constructor(
    private readonly managed: ManagedEnvironment,
    private readonly port: number,
    private readonly createHandoffUrl: () => string,
    private readonly invalidateHandoffs: () => void,
    private readonly webSocketFactory: RuntimeControlWebSocketFactory,
  ) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw runtimeControlError('ENDPOINT_INVALID')
    }
  }

  /**
   * Connect, authenticate through HTTP headers, and send `hello`.
   * @returns capability-free state after the hello frame is sent.
   */
  async connect(): Promise<RuntimeControlState> {
    if (this.phase !== 'CREATED') throw runtimeControlError('STATE_INVALID')
    this.phase = 'CONNECTING'
    try {
      this.socket = this.webSocketFactory(this.managed.controlUrl, {
        headers: {
          authorization: `Bearer ${this.managed.grant}`,
          'x-devboard-run-id': this.managed.runId,
        },
      })
    } catch {
      this.failClosed(1011, 'control connection failed', 'CONNECT_FAILED')
      throw runtimeControlError('CONNECT_FAILED')
    }
    this.socket.addEventListener('message', this.onMessage)
    this.socket.addEventListener('close', this.onClose)
    this.socket.addEventListener('error', this.onError)
    return new Promise<RuntimeControlState>((resolve, reject) => {
      this.connectReject = reject
      this.socket?.addEventListener('open', () => {
        if (this.phase !== 'CONNECTING') return
        try {
          this.send({
            protocol: PROTOCOL,
            type: 'hello',
            runId: this.managed.runId,
            manifestId: MANIFEST_ID,
            openMode: OPEN_MODE,
          })
          this.phase = 'HELLO'
          this.connectReject = undefined
          resolve(this.getState())
        } catch {
          this.failClosed(1011, 'control send failed', 'SEND_FAILED')
        }
      }, { once: true })
    })
  }

  /**
   * Send `ready` after the authenticated HTTP application has settled.
   * @returns capability-free ready state.
   */
  markReady(): RuntimeControlState {
    if (this.phase !== 'HELLO') throw runtimeControlError('STATE_INVALID')
    try {
      this.send({
        protocol: PROTOCOL,
        type: 'ready',
        runId: this.managed.runId,
        endpoint: { id: ENDPOINT_ID, host: LOOPBACK_HOST, port: this.port },
        openMode: OPEN_MODE,
      })
      this.phase = 'READY'
      return this.getState()
    } catch {
      this.failClosed(1011, 'control send failed', 'SEND_FAILED')
      throw runtimeControlError('SEND_FAILED')
    }
  }

  /** Close this one run and revoke every outstanding browser capability. */
  async close(): Promise<void> {
    this.invalidateHandoffs()
    this.phase = 'CLOSED'
    const socket = this.socket
    if (socket === undefined || socket.readyState > SOCKET_CLOSING) return
    const closed = new Promise<void>(resolve => this.closeWaiters.add(resolve))
    if (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN) {
      socket.close(1000, 'runtime shutdown')
    }
    await closed
  }

  /**
   * Read capability-free lifecycle state for diagnostics and tests.
   * @returns the current protocol phase without credentials or URLs.
   */
  getState(): RuntimeControlState {
    return Object.freeze({ protocol: PROTOCOL, phase: this.phase, openMode: OPEN_MODE })
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (this.phase !== 'READY'
      || typeof event.data !== 'string'
      || Buffer.byteLength(event.data, 'utf8') > MAX_FRAME_BYTES) {
      this.failClosed(1008, 'invalid control request', 'MESSAGE_INVALID')
      return
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(event.data)
    } catch {
      this.failClosed(1008, 'invalid control request', 'MESSAGE_INVALID')
      return
    }
    const request = parseOpenRequest(decoded, this.managed.runId)
    if (request === undefined) {
      this.failClosed(1008, 'invalid control request', 'MESSAGE_INVALID')
      return
    }
    let handoffUrl: string | undefined
    try {
      handoffUrl = canonicalHandoffUrl(this.createHandoffUrl(), this.port)
    } catch {
      // Capability creation failures are represented on the control protocol.
    }
    if (handoffUrl === undefined) {
      this.invalidateHandoffs()
      this.sendOpenUnavailable(request.requestId)
      return
    }
    try {
      this.send({
        protocol: PROTOCOL,
        type: 'open.response',
        runId: this.managed.runId,
        requestId: request.requestId,
        status: 'available',
        handoffUrl,
      })
    } catch {
      this.failClosed(1011, 'control send failed', 'SEND_FAILED')
    }
  }

  private readonly onClose = (): void => {
    this.invalidateHandoffs()
    this.phase = 'CLOSED'
    this.connectReject?.(runtimeControlError('CONNECT_FAILED'))
    this.connectReject = undefined
    for (const resolve of this.closeWaiters) resolve()
    this.closeWaiters.clear()
  }

  private readonly onError = (): void => {
    this.failClosed(1011, 'control connection failed', 'CONNECT_FAILED')
  }

  private sendOpenUnavailable(requestId: string): void {
    try {
      this.send({
        protocol: PROTOCOL,
        type: 'open.response',
        runId: this.managed.runId,
        requestId,
        status: 'unavailable',
        code: 'OPEN_UNAVAILABLE',
      })
    } catch {
      this.failClosed(1011, 'control send failed', 'SEND_FAILED')
    }
  }

  private send(message: object): void {
    if (this.socket?.readyState !== SOCKET_OPEN) throw runtimeControlError('NOT_CONNECTED')
    const serialized = JSON.stringify(message)
    /* v8 ignore next 3 -- every outbound field is fixed-width or bounded by
    canonicalHandoffUrl below this protocol limit; retain the transport backstop. */
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FRAME_BYTES) {
      throw runtimeControlError('FRAME_TOO_LARGE')
    }
    this.socket.send(serialized)
  }

  private failClosed(code: number, reason: string, errorCode: string): void {
    this.invalidateHandoffs()
    this.phase = 'CLOSED'
    this.connectReject?.(runtimeControlError(errorCode))
    this.connectReject = undefined
    const socket = this.socket
    if (socket !== undefined
      && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      socket.close(code, reason)
    }
  }
}

/**
 * Create managed control only when all three process-inherited inputs are
 * present and valid; partial or file-sourced configuration fails closed.
 * @param options - launch environment, bound port, capability owner, and test transport.
 * @returns one managed controller, or `undefined` for an ordinary standalone launch.
 */
export function createDevBoardRuntimeControl(
  options: RuntimeControlOptions,
): DevBoardRuntimeControl | undefined {
  const managed = resolveManagedEnvironment(options.environment)
  if (managed === undefined) return undefined
  return new DevBoardRuntimeControl(
    managed,
    options.port,
    options.createHandoffUrl,
    options.invalidateHandoffs,
    options.webSocketFactory ?? platformWebSocketFactory,
  )
}
