import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types'
import * as ProjectionPlugin from '../src/projection.ts'
import type { ToolCallStatsProjection } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => { await ctx.fiber.dispose() }))
})

async function harness(withProjection = true): Promise<{ ctx: Context; create: (id: string) => Session }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withProjection) await ctx.plugin(ProjectionPlugin)
  return {
    ctx,
    create: id => ctx.sessions.create(SessionId(id)),
  }
}

function appendRootCall(
  session: Session,
  name: string,
  id: string,
  isError = false,
): void {
  const callId = ToolCallId(id)
  session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: [], isError }),
  }, { surfaceOp: 'append' })
}

function appendNestedCall(
  session: Session,
  name: string,
  id: string,
  isError = false,
): void {
  const rootCallId = ToolCallId(`root-${id}`)
  const subCallId = ToolCallId(id)
  const data = {
    rootCallId,
    parentCallId: rootCallId,
    subCallId,
    name,
    arguments: {},
  }
  session.append('tool/ptc-dispatch-start', data)
  session.append('tool/ptc-dispatch', { ...data, isError, content: [] })
}

function stats(ctx: Context, session: Session): ToolCallStatsProjection {
  const value = ctx.sessionProjections.snapshot(session).values.toolCallStats
  if (value === undefined) throw new Error('expected toolCallStats projection')
  return value
}

describe('tool call statistics projection', () => {
  it('keeps root and nested tool counts isolated by Session', async () => {
    const { ctx, create } = await harness()
    const first = create('first')
    const second = create('second')

    appendRootCall(first, 'read', 'first-read')
    appendRootCall(first, 'read', 'first-read-failed', true)
    appendNestedCall(first, 'bash', 'first-bash')
    appendRootCall(second, 'write', 'second-write')

    expect(stats(ctx, first)).toMatchObject({
      totalCalls: 3,
      totalSuccesses: 2,
      totalFailures: 1,
      tools: [
        { name: 'bash', calls: 1, successes: 1, failures: 0 },
        { name: 'read', calls: 2, successes: 1, failures: 1 },
      ],
    })
    expect(stats(ctx, second)).toMatchObject({
      totalCalls: 1,
      totalSuccesses: 1,
      totalFailures: 0,
      tools: [{ name: 'write', calls: 1, successes: 1, failures: 0 }],
    })
  })

  it('replays calls recorded before the projection plugin mounts', async () => {
    const { ctx, create } = await harness(false)
    const session = create('late')
    appendRootCall(session, 'read', 'late-read')
    expect('toolCallStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)

    await ctx.plugin(ProjectionPlugin)

    expect(stats(ctx, session)).toMatchObject({
      totalCalls: 1,
      tools: [{ name: 'read', calls: 1, successes: 1, failures: 0 }],
    })
  })

  it('does not publish a count for an unmatched result or abandoned call', async () => {
    const { ctx, create } = await harness()
    const session = create('unmatched')
    const callId = ToolCallId('missing')
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId, content: [], isError: true }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('abandoned'),
      name: 'bash',
      arguments: '{}',
    })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(stats(ctx, session)).toEqual({
      updatedAt: null,
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      tools: [],
    })
  })
})
