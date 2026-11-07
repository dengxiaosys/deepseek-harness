/**
 * Whole-Session tool-call count projection for the browser dashboard.
 *
 * @module dsh-tool-call-recorder/projection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types'
import { z } from 'zod'
import type { ToolCallCount, ToolCallStatsProjection } from './types.ts'

interface ToolCallStatsState {
  readonly view: ToolCallStatsProjection
  readonly pendingCalls: Readonly<Record<string, string>>
}

const countSchema: z.ZodType<ToolCallCount> = z.object({
  name: z.string(),
  calls: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
}).strict()

const viewSchema: z.ZodType<ToolCallStatsProjection> = z.object({
  updatedAt: z.number().nonnegative().nullable(),
  totalCalls: z.number().int().nonnegative(),
  totalSuccesses: z.number().int().nonnegative(),
  totalFailures: z.number().int().nonnegative(),
  tools: z.array(countSchema),
}).strict()

const stateSchema: z.ZodType<ToolCallStatsState> = z.object({
  view: viewSchema,
  pendingCalls: z.record(z.string(), z.string()),
}).strict()

const EMPTY_VIEW: ToolCallStatsProjection = {
  updatedAt: null,
  totalCalls: 0,
  totalSuccesses: 0,
  totalFailures: 0,
  tools: [],
}

function includeCall(
  state: ToolCallStatsState,
  name: string,
  isError: boolean,
  time: number,
): ToolCallStatsState {
  const index = state.view.tools.findIndex(tool => tool.name === name)
  const current = index < 0
    ? { name, calls: 0, successes: 0, failures: 0 }
    : state.view.tools[index]
  /* v8 ignore next -- index and current are derived from the same array lookup. */
  if (current === undefined) throw new Error('tool-call-recorder: projected tool count disappeared')
  const next: ToolCallCount = {
    name,
    calls: current.calls + 1,
    successes: current.successes + (isError ? 0 : 1),
    failures: current.failures + (isError ? 1 : 0),
  }
  const tools = index < 0
    ? [...state.view.tools, next].sort((left, right) => left.name.localeCompare(right.name))
    : state.view.tools.map((tool, toolIndex) => toolIndex === index ? next : tool)
  return {
    ...state,
    view: {
      updatedAt: time,
      totalCalls: state.view.totalCalls + 1,
      totalSuccesses: state.view.totalSuccesses + (isError ? 0 : 1),
      totalFailures: state.view.totalFailures + (isError ? 1 : 0),
      tools,
    },
  }
}

/** Projection definition shared by the Host registration and focused tests. */
export const toolCallStatsProjectionDefinition = {
  key: 'toolCallStats',
  stateVersion: 1,
  stateSchema,
  init: (): ToolCallStatsState => ({ view: EMPTY_VIEW, pendingCalls: {} }),
  apply: (state, event) => {
    switch (event.type) {
      case 'tool/call':
        return {
          ...state,
          pendingCalls: { ...state.pendingCalls, [event.data.callId]: event.data.name },
        }
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const name = Object.hasOwn(state.pendingCalls, callId)
          ? state.pendingCalls[callId]
          : undefined
        if (name === undefined) return state
        const pendingCalls = Object.fromEntries(
          Object.entries(state.pendingCalls).filter(([pendingId]) => pendingId !== callId),
        )
        return includeCall(
          { ...state, pendingCalls },
          name,
          event.data.message.isError === true,
          event.time,
        )
      }
      case 'tool/ptc-dispatch':
        return includeCall(state, event.data.name, event.data.isError, event.time)
      case 'turn/end':
        return Object.keys(state.pendingCalls).length === 0
          ? state
          : { ...state, pendingCalls: {} }
      default:
        return state
    }
  },
  wire: {
    viewSchema,
    view: state => state.view,
    summary: false,
  },
} satisfies ProjectionDefinition<'toolCallStats', ToolCallStatsState>

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-call-recorder-projection'

/** The Session projection registry owns historical replay and per-Session cells. */
export const inject = ['sessionProjections']

/**
 * Register the dashboard projection.
 * @param ctx - Host context carrying the Session projection registry.
 * @returns after the projection is ready for Session snapshots.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.sessionProjections.register(toolCallStatsProjectionDefinition)
}
