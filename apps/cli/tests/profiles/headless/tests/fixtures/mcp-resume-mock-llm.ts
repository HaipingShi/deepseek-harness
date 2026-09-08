import type { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/**
 * Keyless two-process MCP resume adapter. `MCP_PHASE` selects the scripted
 * turn: phase `a` (process A) and phase `b` (process B) each issue one
 * `mcp__fixture__greet` call — naming a phase-distinct target — and then a
 * final text answer, so each persisted log proves its own real tools/call
 * round trip.
 */

const phase = process.env.MCP_PHASE === 'b' ? 'b' : 'a'
const greetName = phase === 'b' ? 'second-process' : 'first-process'

class McpResumeMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const toolResult = _options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const args = JSON.stringify({ name: greetName })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId(`mcp-resume-${phase}`), name: 'mcp__fixture__greet', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`mcp-resume-${phase}`), name: 'mcp__fixture__greet', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const reply = `phase ${phase} complete`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 6, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'mcp-resume-mock-llm'
export const inject = ['llm']

/** Register the keyless `mcp-resume-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mcp-resume-mock'], new McpResumeMockAdapter())
}
