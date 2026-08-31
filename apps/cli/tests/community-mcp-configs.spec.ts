/**
 * Community MCP examples stay default-off and dependency-free. This suite
 * validates their fixed upstream contract, substitutes package-owned MCP
 * fixtures, and proves the real Loader discovers tools through each overlay.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as McpClient from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { startHttpMcpFixture, type HttpMcpFixture } from '../../../packages/mcp/mcp-client/tests/http-fixture.ts'

interface InsertedRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

const root = resolve(import.meta.dirname, '../../..')
const toolHiveOverlay = resolve(root, 'apps/cli/config/examples/mcp-runtime/toolhive.cordis.yml')
const baseConfig = resolve(import.meta.dirname, 'fixtures/community-mcp-base.cordis.yml')
const liveContexts = new Set<Context>()
const fixtures = new Set<HttpMcpFixture>()
const originalToolHiveUrl = process.env.DSH_TOOLHIVE_MCP_URL

afterEach(async () => {
  await Promise.all([...liveContexts].map(async ctx => ctx.fiber.dispose()))
  await Promise.all([...fixtures].map(async fixture => fixture.close()))
  liveContexts.clear()
  fixtures.clear()
  if (originalToolHiveUrl === undefined) delete process.env.DSH_TOOLHIVE_MCP_URL
  else process.env.DSH_TOOLHIVE_MCP_URL = originalToolHiveUrl
})

function insertedRow(patches: PatchOptions[]): InsertedRow {
  expect(patches).toHaveLength(1)
  const insert = patches[0]?.insert
  expect(insert).toHaveLength(1)
  return insert?.[0] as InsertedRow
}

async function waitForTool(ctx: Context, name: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!ctx.tools.schemas().some(schema => schema.name === name)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${name}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
}

async function bootOverlay(file: string): Promise<Context> {
  const patches = loadOverlayPatches('community-mcp-config-test', file)
  insertedRow(patches).name = 'cordis:community-mcp-test-client'
  const ctx = await boot(
    'community-mcp-config-test',
    baseConfig,
    patches,
    (ctx) => {
      liveContexts.add(ctx)
      ctx.loader.builtins['community-mcp-test-system-prompt'] = SystemPrompt
      ctx.loader.builtins['community-mcp-test-tools'] = ToolRuntime
      ctx.loader.builtins['community-mcp-test-client'] = McpClient
    },
  )
  return ctx
}

describe('ToolHive MCP example overlay', () => {
  it('pins the reviewed ToolHive contract and fails loud at startup', () => {
    process.env.DSH_TOOLHIVE_MCP_URL = 'http://127.0.0.1:43123/mcp'
    const source = readFileSync(toolHiveOverlay, 'utf8')
    const row = insertedRow(loadOverlayPatches('community-mcp-config-test', toolHiveOverlay))

    expect(source.split('\n', 1)[0]).toContain('v0.46.0')
    expect(row.id).toBe('mcp-toolhive')
    expect(row.name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(row.config).toMatchObject({
      serverName: 'toolhive',
      transport: 'streamable-http',
      headers: {},
      failOnStartupError: true,
    })
    expect(source).toContain('url: !!js process.env.DSH_TOOLHIVE_MCP_URL')
    expect(source).not.toMatch(/(?:api[_-]?key|password|secret|bearer)\s*[:=]\s*[^\s$]/i)
  })

  it('rejects an unset ToolHive endpoint before any connection attempt', async () => {
    delete process.env.DSH_TOOLHIVE_MCP_URL
    await expect(bootOverlay(toolHiveOverlay)).rejects.toThrow()
  })

  it('loads through the real Loader and discovers a keyless HTTP fixture tool', async () => {
    const fixture = await startHttpMcpFixture()
    fixtures.add(fixture)
    process.env.DSH_TOOLHIVE_MCP_URL = fixture.url

    const ctx = await bootOverlay(toolHiveOverlay)
    await waitForTool(ctx, 'mcp__toolhive__ping')
  }, 15_000)
})
