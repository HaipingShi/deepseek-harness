/** Real `dsh web` managed by a test-owned DevBoard Runtime Protocol server. */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket, { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DSH_SOURCE_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
const RUNTIME_MANIFEST = join(REPO_ROOT, '.devboard/runtime.json')
const TSX_LOADER = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
const RUN_ID = '123e4567-e89b-42d3-a456-426614174000'
const GRANT = 'g'.repeat(43)

interface RunningWeb {
  readonly child: ChildProcess
  readonly output: () => string
}

interface RuntimeFrame {
  readonly protocol: string
  readonly type: string
  readonly runId: string
  readonly requestId?: string
  readonly status?: string
  readonly handoffUrl?: string
  readonly endpoint?: { readonly id: string; readonly host: string; readonly port: number }
}

interface FrameWaiter {
  readonly type: string
  readonly startIndex: number
  readonly resolve: (frame: RuntimeFrame) => void
  readonly reject: (error: Error) => void
  timer?: NodeJS.Timeout
}

function decodeTextFrame(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.concat(data).toString('utf8')
}

function redactFixtureDiagnostics(value: unknown): string {
  const text = value instanceof Error ? value.stack ?? value.message : String(value)
  return text
    .replaceAll(GRANT, '<redacted-control-grant>')
    .replace(/([?&]token=)[A-Za-z0-9_-]+/gu, '$1<redacted>')
}

class DevBoardFixture {
  readonly server = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/runtime-control/v1' })
  readonly frames: RuntimeFrame[] = []
  request: IncomingMessage | undefined
  socket: WebSocket | undefined
  private readonly waiters = new Set<FrameWaiter>()

  async start(): Promise<void> {
    await once(this.server, 'listening')
    this.server.on('connection', (socket, request) => {
      this.request = request
      this.socket = socket
      socket.on('message', (data, isBinary) => {
        if (isBinary) return
        const frame = JSON.parse(decodeTextFrame(data)) as RuntimeFrame
        this.frames.push(frame)
        for (const waiter of this.waiters) {
          if (this.frames.length <= waiter.startIndex || frame.type !== waiter.type) continue
          if (waiter.timer !== undefined) clearTimeout(waiter.timer)
          this.waiters.delete(waiter)
          waiter.resolve(frame)
        }
      })
    })
  }

  get url(): string {
    const port = (this.server.address() as AddressInfo).port
    return `ws://127.0.0.1:${String(port)}/runtime-control/v1`
  }

  send(frame: object): void {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('fixture control socket is not open')
    this.socket.send(JSON.stringify(frame))
  }

  async waitForFrame(type: string, startIndex = 0): Promise<RuntimeFrame> {
    const existing = this.frames.slice(startIndex).find(frame => frame.type === type)
    if (existing !== undefined) return existing
    return new Promise<RuntimeFrame>((resolve, reject) => {
      const waiter: FrameWaiter = {
        type,
        startIndex,
        resolve,
        reject,
      }
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter)
        const frames = redactFixtureDiagnostics(JSON.stringify(this.frames))
        reject(new Error(`fixture did not receive ${type}; frames=${frames}`))
      }, 90_000)
      this.waiters.add(waiter)
    })
  }

  async disconnectRuntime(): Promise<void> {
    const socket = this.socket
    if (socket === undefined || socket.readyState === WebSocket.CLOSED) return
    const closed = once(socket, 'close')
    socket.close(1000, 'fixture disconnect')
    await closed
  }

  async close(): Promise<void> {
    for (const waiter of this.waiters) {
      if (waiter.timer !== undefined) clearTimeout(waiter.timer)
      waiter.reject(new Error('fixture closed before the expected runtime frame'))
    }
    this.waiters.clear()
    await this.disconnectRuntime()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
  }
}

function cleanEnvironment(root: string, dshHome: string, manager: DevBoardFixture): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:KEY|SECRET|TOKEN|PASSWORD)|^DEVBOARD_/iu.test(name)))
  return {
    ...env,
    DEVBOARD_CONTROL_URL: manager.url,
    DEVBOARD_RUN_ID: RUN_ID,
    DEVBOARD_CONTROL_GRANT: GRANT,
    DSH_AGENTS_HOME: join(root, '.agents'),
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    NODE_NO_WARNINGS: '1',
    SSH_CONNECTION: '',
    SSH_TTY: '',
    TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
  }
}

function startWeb(root: string, dshHome: string, manager: DevBoardFixture): RunningWeb {
  const child = spawn(process.execPath, [
    '--import', TSX_LOADER,
    DSH_SOURCE_BIN,
    'web',
    '--port', '0',
  ], {
    cwd: root,
    env: cleanEnvironment(root, dshHome, manager),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const append = (chunk: Buffer | string): void => {
    output = `${output}${String(chunk)}`.slice(-100_000)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  return { child, output: () => output }
}

async function stopWeb(running: RunningWeb): Promise<void> {
  if (running.child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => { running.child.once('exit', () => { resolve() }) })
  running.child.kill('SIGTERM')
  const forced = setTimeout(() => { running.child.kill('SIGKILL') }, 10_000)
  forced.unref()
  await exited
  clearTimeout(forced)
}

function openRequest(requestId: string, origin = 'http://localhost:7100'): object {
  return {
    protocol: 'devboard.runtime-control/v1',
    type: 'open.request',
    runId: RUN_ID,
    requestId,
    origin,
  }
}

describe('dsh web DevBoard runtime control through the real CLI', () => {
  it('declares the project-local structured-control launch', async () => {
    expect(JSON.parse(await readFile(RUNTIME_MANIFEST, 'utf8'))).toEqual({
      protocol: 'devboard.runtime/v1',
      id: 'dsh-web',
      execution: {
        mode: 'shell',
        command: 'pnpm dsh web --no-open --port {{port}}',
        env: { PORT: '{{port}}' },
      },
      endpoint: { id: 'main', protocol: 'http', host: '127.0.0.1', port: '{{port}}' },
      readiness: { type: 'tcp' },
      control: {
        protocol: 'devboard.runtime-control/v1',
        transport: 'websocket',
        openMode: 'session-handoff',
      },
    })
  })

  it('redacts fixture capabilities from failure diagnostics', () => {
    const handoffToken = 'h'.repeat(43)
    const error = new Error(`grant=${GRANT}; handoff=http://127.0.0.1:1234/?token=${handoffToken}`)
    const diagnostic = redactFixtureDiagnostics(error)
    expect(diagnostic.includes(GRANT)).toBe(false)
    expect(diagnostic.includes(handoffToken)).toBe(false)
    expect(diagnostic.includes('<redacted-control-grant>')).toBe(true)
    expect(diagnostic.includes('?token=<redacted>')).toBe(true)
  })

  it('runs hello -> ready -> one-time browser handoff without DSH-owned opening', { timeout: 180_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-control-real-cli-'))
    const dshHome = join(root, '.dsh')
    const manager = new DevBoardFixture()
    let running: RunningWeb | undefined
    try {
      await manager.start()
      running = startWeb(root, dshHome, manager)
      const hello = await manager.waitForFrame('hello')
      const ready = await manager.waitForFrame('ready', 1)
      expect(manager.frames.slice(0, 2).map(frame => frame.type)).toEqual(['hello', 'ready'])
      expect(hello).toEqual({
        protocol: 'devboard.runtime-control/v1',
        type: 'hello',
        runId: RUN_ID,
        manifestId: 'dsh-web',
        openMode: 'session-handoff',
      })
      expect(ready).toMatchObject({
        protocol: 'devboard.runtime-control/v1',
        type: 'ready',
        runId: RUN_ID,
        openMode: 'session-handoff',
      })
      expect(ready.endpoint).toMatchObject({ id: 'main', host: '127.0.0.1' })
      expect(ready.endpoint?.port).toBeGreaterThan(0)
      expect(manager.request?.headers.authorization).toBe(`Bearer ${GRANT}`)
      expect(manager.request?.headers['x-devboard-run-id']).toBe(RUN_ID)

      const requestId = '123e4567-e89b-42d3-a456-426614174001'
      manager.send(openRequest(requestId))
      const response = await manager.waitForFrame('open.response', 2)
      expect(response).toMatchObject({
        protocol: 'devboard.runtime-control/v1',
        type: 'open.response',
        runId: RUN_ID,
        requestId,
        status: 'available',
      })
      if (response.handoffUrl === undefined) throw new Error('runtime omitted handoff URL')
      const handoff = new URL(response.handoffUrl)
      expect(handoff.origin).toBe(`http://127.0.0.1:${String(ready.endpoint?.port)}`)
      expect(handoff.pathname).toBe('/')
      expect(handoff.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/u)

      const exchange = await fetch(handoff, { redirect: 'manual' })
      expect(exchange.status).toBe(303)
      expect(exchange.headers.get('location')).toBe('/')
      const setCookie = exchange.headers.get('set-cookie')
      if (setCookie === null) throw new Error('handoff exchange omitted Set-Cookie')
      const cookie = setCookie.split(';', 1)[0]!
      const clean = await fetch(handoff.origin, { headers: { cookie } })
      expect(clean.status).toBe(200)
      expect(await clean.text()).toContain('<!doctype html>')
      expect((await fetch(handoff, { redirect: 'manual' })).status).toBe(401)

      const pendingRequestId = '123e4567-e89b-42d3-a456-426614174002'
      manager.send(openRequest(pendingRequestId, 'http://127.0.0.1:7100'))
      const pending = await manager.waitForFrame('open.response', 3)
      if (pending.handoffUrl === undefined) throw new Error('runtime omitted pending handoff URL')
      expect(pending.handoffUrl).not.toBe(response.handoffUrl)
      await manager.disconnectRuntime()
      expect((await fetch(pending.handoffUrl, { redirect: 'manual' })).status).toBe(401)

      const output = running.output()
      expect(output).not.toContain(GRANT)
      expect(output).not.toMatch(/[?&]token=/u)
      expect(output).not.toContain('dsh web:')
      expect(output).not.toContain('opening the default browser')
    } catch (error) {
      const failure = redactFixtureDiagnostics(error)
      const output = redactFixtureDiagnostics(running?.output() ?? '')
      throw new Error(`${failure}\n${output}`)
    } finally {
      if (running !== undefined) await stopWeb(running)
      await manager.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
