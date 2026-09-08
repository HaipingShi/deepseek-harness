import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.js'

/**
 * Keyless two-process MCP resume acceptance (task A's A6, real parent
 * processes): two independent `dsh --profile headless` runs share one
 * persistence root and one explicit composition. Process A discovers the
 * fixture MCP server, its scripted model calls the bridged tool, and the
 * process exits; process B boots the SAME composition, RESUMES the persisted
 * session, and proves the request still carries the bridged tools and that a
 * fresh tools/call reaches the new MCP server process.
 *
 * Negative controls separate the field incident's failure mode from startup
 * failure: an overlay WITHOUT the mcp-client row boots fine but the request
 * carries no mcp tools ("not configured"), while a row whose server cannot
 * start fails the boot loudly (`failOnStartupError: true`).
 *
 * This is keyless integration evidence only: no real model, no real
 * `~/.dsh`, no user sessions.
 */

const PROCESS_TIMEOUT_MS = 90_000
const TEST_TIMEOUT_MS = PROCESS_TIMEOUT_MS + 30_000

const repoRoot = fileURLToPath(new URL('../../../../../..', import.meta.url))
const driverScript = fileURLToPath(new URL('../../../../../../packages/test-support/loader-smoke/tests/fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url))
const patchA = join(fixturesDir, 'mcp-resume.patch.yml')
const patchB = join(fixturesDir, 'mcp-resume-second.patch.yml')
const fixtureServer = join(repoRoot, 'packages/mcp/mcp-client/tests/fixture-server.ts')

interface ParsedRun {
  readonly stdout: string
  readonly stderr: string
  readonly events: SessionEvent[]
}

/**
 * The one stderr marker the owning plugin produces when the fixture MCP
 * server's initial connection fails under `failOnStartupError: true`
 * (`mcp-client(serverName): initial connection or tool synchronization failed`).
 * A wrong-exit, a timeout kill, or an unrelated boot error never produces it.
 */
function matchesMcpStartupDiagnostic(stderr: string): boolean {
  return stderr.includes('mcp-client(fixture): initial connection or tool synchronization failed')
}

async function runProcess(label: string, patch: string, task: string, sharedRoot: string, options: { phase?: 'a' | 'b'; fixtureServer?: string; expectedExitCode?: number } = {}): Promise<ParsedRun> {
  const result = await runLoaderSmoke({
    label,
    tempDirPrefix: `${label}-`,
    binScript: driverScript,
    libBinScript: driverScript,
    configPath: patch,
    binArgs: [patch, task],
    tsconfigPath,
    processTimeoutMs: PROCESS_TIMEOUT_MS,
    ...(options.expectedExitCode === undefined ? {} : { expectedExitCode: options.expectedExitCode }),
    env: {
      MCP_RESUME_ROOT: sharedRoot,
      MCP_FIXTURE_SERVER: options.fixtureServer ?? fixtureServer,
      ...(options.phase === undefined ? {} : { MCP_PHASE: options.phase }),
    },
  })
  const events = result.stdout.trimEnd().split('\n').filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as { type: string; event?: SessionEvent })
    .filter(line => line.type === 'session_event' && line.event !== undefined)
    .map(line => line.event as SessionEvent)
  return { stdout: result.stdout, stderr: result.stderr, events }
}

/** Decode the shared session log for one session id from the shared root. */
async function sharedSessionRecords(sharedRoot: string): Promise<Record<string, unknown>[]> {
  const files = await readdir(join(sharedRoot, 'sessions'), { recursive: true })
  const log = files.find(file => file.endsWith('session.jsonl.zstd'))
  expect(log).toBeDefined()
  const compressed = await readFile(join(sharedRoot, 'sessions', log as string))
  const { frames } = scanZstdFrames(compressed)
  return frames.flatMap(({ start, end }) =>
    zstdDecompressSync(compressed.subarray(start, end)).toString().trim().split('\n'))
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

/** The tool names the Nth request header advertised. */
function requestedTools(events: readonly SessionEvent[], request: number): string[] {
  const headers = events.filter(event => event.type === 'request/header')
  const header = headers[request]
  expect(header, `request header ${request}`).toBeDefined()
  const tools = (header?.data as { header?: { tools?: Array<{ name?: string }> } }).header?.tools ?? []
  return tools.flatMap(tool => tool.name === undefined ? [] : [tool.name])
}

const sharedRoot = await mkdtemp(join(tmpdir(), 'mcp-process-resume-'))

afterAll(async () => {
  await rm(sharedRoot, { recursive: true, force: true })
})

describe('mcp-client: bridged tools across two real dsh processes', () => {
  it('process A discovers and calls the fixture tool; process B resumes and calls it again', async () => {
    // Process A: fresh session, discovery + a real tools/call round trip.
    const runA = await runProcess('mcp-resume-process-a', patchA, 'greet through the fixture tool', sharedRoot, { phase: 'a' })
    expect(runA.stderr).toBe('')
    expect(requestedTools(runA.events, 0)).toContain('mcp__fixture__greet')
    const greetA = runA.events.find(event => event.type === 'tool/result')
    expect(JSON.stringify(greetA)).toContain('Hello, first-process!')

    // Process B: a brand-new DSH process resumes the SAME session under the
    // SAME composition; the bridged tools are still on the request and the
    // call reaches the NEW fixture server process.
    const runB = await runProcess('mcp-resume-process-b', patchB, 'greet again through the fixture tool', sharedRoot, { phase: 'b' })
    expect(runB.stderr).toBe('')
    expect(requestedTools(runB.events, 0)).toContain('mcp__fixture__greet')
    const greetB = runB.events.find(event => event.type === 'tool/result')
    expect(JSON.stringify(greetB)).toContain('Hello, second-process!')

    // The shared log proves the cross-process story: one session, a resume
    // seed boundary, and both phases' tool calls persisted durably.
    const records = await sharedSessionRecords(sharedRoot)
    expect(records[0]).toMatchObject({ type: 'session', id: 'mcp-resume-process-a' })
    const calls = records.filter(record => record.type === 'tool/call').map(record => (record.data as { name: string }).name)
    expect(calls.filter(name => name === 'mcp__fixture__greet')).toHaveLength(2)
    expect(records.some(record => record.type === 'session/end-seed')).toBe(true)
  }, TEST_TIMEOUT_MS)

  it('negative control: without the mcp-client row the request carries no mcp tools', async () => {
    const noMcpPatch = join(fixturesDir, 'mcp-resume-no-mcp.patch.yml')
    const noMcpRoot = await mkdtemp(join(tmpdir(), 'mcp-resume-no-mcp-'))
    try {
      const run = await runProcess('mcp-resume-no-mcp', noMcpPatch, 'greet through the fixture tool', noMcpRoot, { phase: 'a' })
      expect(run.stderr).toBe('')
      const headerTools = requestedTools(run.events, 0)
      expect(headerTools.filter(name => name.startsWith('mcp__'))).toEqual([])
      // The model still emitted its scripted call; an unconfigured tool fails
      // as an ordinary tool result — asserted structurally on THAT result.
      const calls = run.events.filter(event => event.type === 'tool/call').map(event => (event.data as { name: string }).name)
      expect(calls).toContain('mcp__fixture__greet')
      const failed = run.events.find((event): event is SessionEvent<'tool/result'> =>
        event.type === 'tool/result' && (event.data as { message: { source: { callId: string } } }).message.source.callId === 'mcp-resume-a')
      expect(failed).toBeDefined()
      const block = failed?.data.message.content[0]
      expect(block).toMatchObject({ type: 'tool-result', isError: true })
    } finally {
      await rm(noMcpRoot, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT_MS)

  it('negative control: failOnStartupError turns an unreachable fixture server into exit 1 with the owning diagnostic', async () => {
    const startupFailPatch = join(fixturesDir, 'mcp-resume-startup-fail.patch.yml')
    const failRoot = await mkdtemp(join(tmpdir(), 'mcp-resume-startup-fail-'))
    try {
      // The helper pins the designed failure exit; any other exit — including
      // a timeout kill — rejects instead of resolving, so an unrelated
      // failure mode cannot masquerade as this negative control.
      const run = await runProcess('mcp-resume-startup-fail', startupFailPatch, 'greet through the fixture tool', failRoot, {
        phase: 'a',
        fixtureServer: join(failRoot, 'definitely-not-an-mcp-server.js'),
        expectedExitCode: 1,
      })
      // The owning plugin's own diagnostic, not the test label and not a
      // generic boot error.
      expect(matchesMcpStartupDiagnostic(run.stderr)).toBe(true)
      // The boot died before any model request or tool execution: no session
      // events were streamed at all.
      expect(run.events).toEqual([])
    } finally {
      await rm(failRoot, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT_MS)
})

describe('startup-failure diagnostic matcher (narrowness controls)', () => {
  const prefix = 'dsh: plugin tree failed to load: '
  const real = `${prefix}failed to apply loader entry mcp-fixture (@deepseek-ai/dsh-mcp-client): `
    + 'mcp-client(fixture): initial connection or tool synchronization failed'

  it('matches the owning plugin diagnostic', () => {
    expect(matchesMcpStartupDiagnostic(real)).toBe(true)
  })

  it('does not match unrelated boot errors, the run label alone, or a timeout report', () => {
    expect(matchesMcpStartupDiagnostic('Error: cannot find package \'@deepseek-ai/dsh-mcp-client\'')).toBe(false)
    expect(matchesMcpStartupDiagnostic('failed to apply loader entry config-syntax (@deepseek-ai/dsh-x): bad indentation of a mapping at line 4')).toBe(false)
    expect(matchesMcpStartupDiagnostic('mcp-resume-startup-fail did not exit within 90s. stdout:\nstderr:\n')).toBe(false)
    expect(matchesMcpStartupDiagnostic('mcp-resume-startup-fail')).toBe(false)
  })
})
