import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ToolExecution,
  ToolExecutionResult,
  ToolExecutionToken,
} from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { ToolCallRecorder, toolCallSessionDirectory } from '../src/recorder.ts'
import type { ToolCallRecord, ToolCallSummary } from '../src/types.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-call-recorder-'))
  temporaryDirectories.push(root)
  return root
}

function agent(id: string): Agent {
  return { id: SessionId(id) } as Agent
}

function execution(
  owner: Agent | undefined,
  name: string,
  call: string,
  args: Record<string, unknown>,
  nested = false,
): ToolExecution {
  const callId = ToolCallId(call)
  return {
    callId,
    rootCallId: nested ? ToolCallId(`root-${call}`) : callId,
    name,
    arguments: args,
    ...(owner === undefined ? {} : { agent: owner }),
    ...(nested ? { parent: Symbol(`parent-${call}`) as ToolExecutionToken } : {}),
    signal: new AbortController().signal,
    token: Symbol(call) as ToolExecutionToken,
  }
}

const success = (value: string, withMeta = true): ToolExecutionResult => ({
  isError: false,
  value: { value },
  content: [{ type: 'text', text: `output:${value}` }],
  ...(withMeta ? { meta: { source: 'test' } } : {}),
})

const failure = (message: string): ToolExecutionResult => ({
  isError: true,
  error: {
    message,
    info: { name: 'FixtureError', code: 'FIXTURE_FAILED', reason: 'fixture reason' },
  },
  content: [{ type: 'text', text: `Error: ${message}` }],
})

async function stored(root: string, sessionId: string): Promise<{
  summary: ToolCallSummary
  records: ToolCallRecord[]
  sessionDirectory: string
}> {
  const sessionDirectory = toolCallSessionDirectory(root, sessionId)
  const summary = JSON.parse(await readFile(join(sessionDirectory, 'summary.json'), 'utf8')) as ToolCallSummary
  const callDirectory = join(sessionDirectory, 'calls')
  const files = (await readdir(callDirectory)).sort()
  const records = await Promise.all(files.map(async file =>
    JSON.parse(await readFile(join(callDirectory, file), 'utf8')) as ToolCallRecord))
  return { summary, records, sessionDirectory }
}

describe('out-of-tree tool call recorder', () => {
  it('records final inputs and outputs with per-tool Session counts', async () => {
    const root = join(await temporaryRoot(), 'records')
    const ctx = new Context()
    const owner = agent('session-a')
    await apply(ctx, { outputDirectory: root })

    ctx.emit('tools/result', execution(owner, 'read', 'call-1', { path: '/a' }), success('one'))
    ctx.emit('tools/result', execution(owner, 'read', 'call-2', { path: '/b' }), failure('no access'))
    ctx.emit('tools/result', execution(owner, 'bash', 'call-3', { command: 'pwd' }, true), success('three'))
    ctx.emit('tools/result', execution(undefined, 'programmatic', 'call-4', {}), success('ignored'))
    ctx.emit('agent/disposed', { agent: agent('session-without-calls') })
    ctx.emit('agent/disposed', { agent: owner })
    await ctx.fiber.dispose()

    const { summary, records, sessionDirectory } = await stored(root, owner.id)
    expect(summary).toMatchObject({
      schemaVersion: 1,
      sessionId: owner.id,
      totalCalls: 3,
      totalSuccesses: 2,
      totalFailures: 1,
      tools: [
        { name: 'bash', calls: 1, successes: 1, failures: 0 },
        { name: 'read', calls: 2, successes: 1, failures: 1 },
      ],
    })
    expect(records.map(record => record.sequence)).toEqual([1, 2, 3])
    expect(records[0]).toMatchObject({
      toolName: 'read',
      dispatch: 'root',
      input: { path: '/a' },
      output: { kind: 'success', value: { value: 'one' }, content: [{ type: 'text', text: 'output:one' }] },
    })
    expect(records[1]).toMatchObject({
      output: {
        kind: 'failure',
        error: {
          message: 'no access',
          name: 'FixtureError',
          code: 'FIXTURE_FAILED',
          reason: 'fixture reason',
        },
      },
    })
    expect(records[2]).toMatchObject({ toolName: 'bash', dispatch: 'nested' })
    if (process.platform !== 'win32') {
      expect((await stat(sessionDirectory)).mode & 0o777).toBe(0o700)
      expect((await stat(join(sessionDirectory, 'summary.json'))).mode & 0o777).toBe(0o600)
      const callFiles = await readdir(join(sessionDirectory, 'calls'))
      for (const file of callFiles) {
        expect((await stat(join(sessionDirectory, 'calls', file))).mode & 0o777).toBe(0o600)
      }
    }
  })

  it('rebuilds counts and sequence numbers after plugin reload', async () => {
    const root = await temporaryRoot()
    const owner = agent('session-reload')

    const first = new Context()
    await apply(first, { outputDirectory: root })
    first.emit('tools/result', execution(owner, 'read', 'call-1', {}), success('one'))
    await first.fiber.dispose()

    const second = new Context()
    await apply(second, { outputDirectory: root })
    second.emit('tools/result', execution(owner, 'write', 'call-2', {}), success('two', false))
    await second.fiber.dispose()

    const { summary, records } = await stored(root, owner.id)
    expect(summary).toMatchObject({
      totalCalls: 2,
      totalSuccesses: 2,
      totalFailures: 0,
      tools: [
        { name: 'read', calls: 1, successes: 1, failures: 0 },
        { name: 'write', calls: 1, successes: 1, failures: 0 },
      ],
    })
    expect(records.map(record => record.sequence)).toEqual([1, 2])
  })

  it('isolates concurrent Session queues and drains them on unload', async () => {
    const root = await temporaryRoot()
    const ctx = new Context()
    const first = agent('session-one')
    const second = agent('session-two')
    await apply(ctx, { outputDirectory: root })

    for (let index = 0; index < 20; index += 1) {
      ctx.emit('tools/result', execution(first, 'read', `first-${index}`, { index }), success(String(index)))
      ctx.emit('tools/result', execution(second, 'bash', `second-${index}`, { index }), success(String(index)))
    }
    await ctx.fiber.dispose()

    expect((await stored(root, first.id)).summary).toMatchObject({
      sessionId: first.id,
      totalCalls: 20,
      tools: [{ name: 'read', calls: 20, successes: 20, failures: 0 }],
    })
    expect((await stored(root, second.id)).summary).toMatchObject({
      sessionId: second.id,
      totalCalls: 20,
      tools: [{ name: 'bash', calls: 20, successes: 20, failures: 0 }],
    })
  })

  it('fails plugin startup for a relative output directory', async () => {
    const ctx = new Context()
    await expect(apply(ctx, { outputDirectory: 'relative/tool-calls' })).rejects.toThrow(
      'outputDirectory must be a non-empty absolute path',
    )
    await ctx.fiber.dispose()
  })

  it('fails plugin startup when the output path is not a directory', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'output-file')
    await writeFile(output, 'occupied')
    const ctx = new Context()
    await expect(apply(ctx, { outputDirectory: output })).rejects.toThrow(
      'outputDirectory is not a directory',
    )
    await ctx.fiber.dispose()
  })

  it('preserves non-missing output path errors', async () => {
    const root = await temporaryRoot()
    const ctx = new Context()
    await expect(apply(ctx, { outputDirectory: `${root}\0invalid` })).rejects.toThrow()
    await ctx.fiber.dispose()
  })

  it('ignores records after the recorder closes', async () => {
    const root = await temporaryRoot()
    const recorder = new ToolCallRecorder(root, vi.fn())
    await recorder.initialize()
    await recorder.close()
    recorder.record(execution(agent('closed-session'), 'read', 'closed-call', {}), success('ignored'))
    expect(await readdir(root)).toEqual([])
  })

  it('rebuilds around malformed durable records and preserves valid records', async () => {
    const root = await temporaryRoot()
    const owner = agent('session-malformed')
    const warn = vi.fn()
    const first = new Context()
    vi.spyOn(first.logger, 'warn').mockImplementation(warn)
    await apply(first, { outputDirectory: root })
    first.emit('tools/result', execution(owner, 'alpha', 'call-1', {}), success('one'))
    first.emit('tools/result', execution(owner, 'zeta', 'call-failed', {}), failure('existing failure'))
    await first.fiber.dispose()

    const calls = join(toolCallSessionDirectory(root, owner.id), 'calls')
    const malformed: Readonly<Record<string, string>> = {
      '000000000010-array.json': '[]',
      '000000000011-version.json': '{"schemaVersion":2}',
      '000000000012-sequence-type.json': '{"schemaVersion":1,"sequence":"1"}',
      '000000000013-sequence-fraction.json': '{"schemaVersion":1,"sequence":1.5}',
      '000000000014-sequence-zero.json': '{"schemaVersion":1,"sequence":0}',
      '000000000015-completed.json': '{"schemaVersion":1,"sequence":15,"completedAt":1,"toolName":"x","output":{"kind":"success"}}',
      '000000000016-tool-type.json': '{"schemaVersion":1,"sequence":16,"completedAt":"2020","toolName":1,"output":{"kind":"success"}}',
      '000000000017-tool-empty.json': '{"schemaVersion":1,"sequence":17,"completedAt":"2020","toolName":"","output":{"kind":"success"}}',
      '000000000018-output-type.json': '{"schemaVersion":1,"sequence":18,"completedAt":"2020","toolName":"x","output":[]}',
      '000000000019-output-kind.json': '{"schemaVersion":1,"sequence":19,"completedAt":"2020","toolName":"x","output":{"kind":"other"}}',
      '000000000020-invalid-json.json': '{',
    }
    await Promise.all(Object.entries(malformed).map(([file, content]) => writeFile(join(calls, file), content)))
    await writeFile(join(calls, 'ignored.txt'), '{}')
    await mkdir(join(calls, 'ignored.json'))
    await writeFile(join(calls, '000000000040-manual.json'), JSON.stringify({
      schemaVersion: 1,
      sequence: 40,
      completedAt: '2000-01-01T00:00:00.000Z',
      toolName: 'zeta',
      output: { kind: 'success' },
    }))

    const second = new Context()
    vi.spyOn(second.logger, 'warn').mockImplementation(warn)
    await apply(second, { outputDirectory: root })
    second.emit('tools/result', execution(owner, 'zeta', 'call-2', {}), {
      isError: true,
      error: { message: 'plain failure' },
      content: [{ type: 'text', text: 'Error: plain failure' }],
      meta: { source: 'test' },
    })
    second.emit('tools/result', execution(owner, 'zeta', 'call-3', {}), {
      isError: true,
      error: { message: 'coded failure', info: { name: 'CodedError', code: 'CODED' } },
      content: [{ type: 'text', text: 'Error: coded failure' }],
    })
    await second.fiber.dispose()

    const sessionDirectory = toolCallSessionDirectory(root, owner.id)
    const summary = JSON.parse(await readFile(join(sessionDirectory, 'summary.json'), 'utf8')) as ToolCallSummary
    expect(summary).toMatchObject({
      totalCalls: 5,
      totalSuccesses: 2,
      totalFailures: 3,
      tools: [
        { name: 'alpha', calls: 1, successes: 1, failures: 0 },
        { name: 'zeta', calls: 4, successes: 1, failures: 3 },
      ],
    })
    const files = await readdir(join(sessionDirectory, 'calls'))
    expect(files.some(file => file.startsWith('000000000041-'))).toBe(true)
    expect(files.some(file => file.startsWith('000000000042-'))).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('contains filesystem failures without rejecting teardown', async () => {
    const root = await temporaryRoot()
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const owner = agent('session-failure')
    await apply(ctx, { outputDirectory: root })
    await rm(root, { recursive: true, force: true })
    await writeFile(root, 'occupied')

    ctx.emit('tools/result', execution(owner, 'read', 'failed-write', {}), success('value'))
    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not persist tool "read" call "failed-write"'),
      expect.anything(),
    )
  })
})
