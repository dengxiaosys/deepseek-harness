/**
 * Private local persistence for tool-call observations.
 *
 * Each completed call is the authoritative record. `summary.json` is a
 * replaceable derivative rebuilt from those records after plugin reload.
 *
 * @module dsh-tool-call-recorder/recorder
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  ToolCallCount,
  ToolCallFailureRecord,
  ToolCallOutcomeRecord,
  ToolCallRecord,
  ToolCallSummary,
  ToolCallSuccessRecord,
} from './types.ts'

const CALLS_DIRECTORY = 'calls'
const SUMMARY_FILE = 'summary.json'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

interface PendingToolCallObservation {
  readonly schemaVersion: 1
  readonly completedAt: string
  readonly sessionId: string
  readonly callId: string
  readonly rootCallId: string
  readonly toolName: string
  readonly dispatch: 'root' | 'nested'
  readonly input: unknown
  readonly result: Readonly<ToolExecutionResult>
}

interface MutableToolCallCount {
  calls: number
  successes: number
  failures: number
}

interface SummaryState {
  readonly tools: Map<string, MutableToolCallCount>
  totalCalls: number
  totalSuccesses: number
  totalFailures: number
  maxSequence: number
  updatedAt: string
}

interface StoredRecordIdentity {
  readonly sequence: number
  readonly completedAt: string
  readonly toolName: string
  readonly outcome: ToolCallOutcomeRecord['kind']
}

/** Logger callback used to contain recorder failures outside tool execution. */
export type ToolCallRecorderFailureReporter = (message: string, error: unknown) => void

/**
 * Resolve the stable private directory for one opaque Session id.
 * @param root - configured recorder root.
 * @param sessionId - opaque Session identity.
 * @returns stable hashed directory below the recorder root.
 */
export function toolCallSessionDirectory(root: string, sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
  return join(root, `session-${digest}`)
}

/** Recorder for final tool results, grouped and serialized independently per Session. */
export class ToolCallRecorder {
  private readonly sessions = new Map<SessionId, SessionWriter>()
  private closed = false

  constructor(
    private readonly root: string,
    private readonly reportFailure: ToolCallRecorderFailureReporter,
  ) {}

  /**
   * Create or verify the configured recorder root before listener activation.
   * @returns after the path exists and is a directory.
   */
  async initialize(): Promise<void> {
    let metadata
    try {
      metadata = await stat(this.root)
    } catch (error: unknown) {
      if (!isErrno(error, 'ENOENT')) throw error
      await mkdir(this.root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      metadata = await stat(this.root)
    }
    if (!metadata.isDirectory()) {
      throw new Error(`tool-call-recorder: outputDirectory is not a directory: ${JSON.stringify(this.root)}`)
    }
  }

  /**
   * Snapshot one final tool result and enqueue it without delaying tool settlement.
   * Agent-less programmatic calls have no Session owner and are ignored.
   * @param exec - immutable execution identity and arguments.
   * @param result - immutable final result.
   */
  record(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    if (this.closed) return
    if (exec.agent === undefined) return
    const record: PendingToolCallObservation = {
      schemaVersion: 1,
      completedAt: new Date().toISOString(),
      sessionId: exec.agent.id,
      callId: exec.callId,
      rootCallId: exec.rootCallId,
      toolName: exec.name,
      dispatch: exec.parent === undefined ? 'root' : 'nested',
      input: exec.arguments,
      result,
    }
    let writer = this.sessions.get(exec.agent.id)
    if (writer === undefined) {
      writer = new SessionWriter(this.root, exec.agent.id, this.reportFailure)
      this.sessions.set(exec.agent.id, writer)
    }
    writer.enqueue(record)
  }

  /**
   * Retire one Session writer after every accepted record reaches a terminal
   * persistence outcome. The next Agent with the same id rebuilds from disk.
   * @param sessionId - disposed Agent identity.
   */
  release(sessionId: SessionId): void {
    const writer = this.sessions.get(sessionId)
    if (writer === undefined) return
    void writer.drain().then(() => {
      this.sessions.delete(sessionId)
    })
  }

  /**
   * Stop admission and await every Session queue.
   * @returns after all accepted writes have settled.
   */
  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.sessions.values()].map(writer => writer.drain()))
    this.sessions.clear()
  }
}

class SessionWriter {
  private tail: Promise<void> = Promise.resolve()
  private state: SummaryState | undefined

  constructor(
    private readonly root: string,
    private readonly sessionId: SessionId,
    private readonly reportFailure: ToolCallRecorderFailureReporter,
  ) {}

  enqueue(pending: PendingToolCallObservation): void {
    const persist = this.tail.then(async () => {
      this.state ??= await rebuildSummaryState(this.sessionDirectory(), this.reportFailure)
      const sequence = this.state.maxSequence + 1
      const {
        result,
        ...identity
      } = pending
      const record: ToolCallRecord = {
        ...identity,
        sequence,
        input: jsonSnapshot(pending.input),
        output: outcomeRecord(result, jsonSnapshot(result.content)),
      }
      const callPath = join(
        this.callsDirectory(),
        `${String(sequence).padStart(12, '0')}-${randomUUID()}.json`,
      )
      await writeFileAtomic(callPath, `${JSON.stringify(record)}\n`, {
        mode: PRIVATE_FILE_MODE,
        dirMode: PRIVATE_DIRECTORY_MODE,
      })
      includeRecord(this.state, {
        sequence,
        completedAt: record.completedAt,
        toolName: record.toolName,
        outcome: record.output.kind,
      })
      await writeFileAtomic(
        join(this.sessionDirectory(), SUMMARY_FILE),
        `${JSON.stringify(summaryOf(this.sessionId, this.state), null, 2)}\n`,
        { mode: PRIVATE_FILE_MODE, dirMode: PRIVATE_DIRECTORY_MODE },
      )
    })
    this.tail = persist.catch((error: unknown) => {
      this.reportFailure(
        `tool-call-recorder: could not persist tool "${pending.toolName}" call "${pending.callId}" for Session "${this.sessionId}"`,
        error,
      )
    })
  }

  drain(): Promise<void> {
    return this.tail
  }

  private sessionDirectory(): string {
    return toolCallSessionDirectory(this.root, this.sessionId)
  }

  private callsDirectory(): string {
    return join(this.sessionDirectory(), CALLS_DIRECTORY)
  }
}

function outcomeRecord(
  result: Readonly<ToolExecutionResult>,
  content: JsonValue,
): ToolCallOutcomeRecord {
  if (!result.isError) {
    const output: ToolCallSuccessRecord = {
      kind: 'success',
      value: result.value,
      content,
      ...(result.meta === undefined ? {} : { meta: result.meta }),
    }
    return output
  }
  const { info } = result.error
  const output: ToolCallFailureRecord = {
    kind: 'failure',
    error: {
      message: result.error.message,
      ...(info === undefined ? {} : {
        name: info.name,
        code: info.code,
        ...(info.reason === undefined ? {} : { reason: info.reason }),
      }),
    },
    content,
    ...(result.meta === undefined ? {} : { meta: result.meta }),
  }
  return output
}

function emptySummaryState(): SummaryState {
  return {
    tools: new Map(),
    totalCalls: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    maxSequence: 0,
    updatedAt: '',
  }
}

async function rebuildSummaryState(
  sessionDirectory: string,
  reportFailure: ToolCallRecorderFailureReporter,
): Promise<SummaryState> {
  const state = emptySummaryState()
  const callsDirectory = join(sessionDirectory, CALLS_DIRECTORY)
  let entries
  try {
    entries = await readdir(callsDirectory, { withFileTypes: true })
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) return state
    throw error
  }
  const files = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort()
  for (const file of files) {
    const path = join(callsDirectory, file)
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      const record = storedRecordIdentity(parsed)
      if (record === undefined) {
        reportFailure(`tool-call-recorder: ignored malformed call record ${JSON.stringify(path)}`, new TypeError('invalid call record'))
        continue
      }
      includeRecord(state, record)
    } catch (error: unknown) {
      reportFailure(`tool-call-recorder: ignored unreadable call record ${JSON.stringify(path)}`, error)
    }
  }
  return state
}

function storedRecordIdentity(value: unknown): StoredRecordIdentity | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined
  if (typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1) return undefined
  if (typeof value.completedAt !== 'string' || typeof value.toolName !== 'string' || value.toolName.length === 0) return undefined
  if (!isRecord(value.output) || (value.output.kind !== 'success' && value.output.kind !== 'failure')) return undefined
  return {
    sequence: value.sequence,
    completedAt: value.completedAt,
    toolName: value.toolName,
    outcome: value.output.kind,
  }
}

function includeRecord(state: SummaryState, record: StoredRecordIdentity): void {
  let tool = state.tools.get(record.toolName)
  if (tool === undefined) {
    tool = { calls: 0, successes: 0, failures: 0 }
    state.tools.set(record.toolName, tool)
  }
  tool.calls += 1
  state.totalCalls += 1
  if (record.outcome === 'success') {
    tool.successes += 1
    state.totalSuccesses += 1
  } else {
    tool.failures += 1
    state.totalFailures += 1
  }
  state.maxSequence = Math.max(state.maxSequence, record.sequence)
  if (record.completedAt > state.updatedAt) state.updatedAt = record.completedAt
}

function summaryOf(sessionId: SessionId, state: SummaryState): ToolCallSummary {
  const tools: ToolCallCount[] = [...state.tools.entries()]
    .sort(([left], [right]) => left > right ? 1 : -1)
    .map(([name, count]) => ({ name, ...count }))
  return {
    schemaVersion: 1,
    sessionId,
    updatedAt: state.updatedAt,
    totalCalls: state.totalCalls,
    totalSuccesses: state.totalSuccesses,
    totalFailures: state.totalFailures,
    tools,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Detach the lossless JSON guaranteed by the final tool-result event. */
function jsonSnapshot(value: unknown): JsonValue {
  const snapshot = snapshotJsonValue(value)
  /* v8 ignore next 2 -- tools/result materializes lossless JSON before observers run. */
  if (snapshot === undefined) throw new TypeError('tool-call-recorder: tools/result contained non-lossless JSON')
  return snapshot as JsonValue
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}
