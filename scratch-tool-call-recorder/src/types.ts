/** Persisted JSON records produced by the out-of-tree tool call recorder. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

/** Persisted success from one completed tool execution. */
export interface ToolCallSuccessRecord {
  readonly kind: 'success'
  readonly value: JsonValue
  readonly content: JsonValue
  readonly meta?: JsonValue
}

/** Persisted structured failure from one completed tool execution. */
export interface ToolCallFailureRecord {
  readonly kind: 'failure'
  readonly error: {
    readonly message: string
    readonly name?: string
    readonly code?: string
    readonly reason?: string
  }
  readonly content: JsonValue
  readonly meta?: JsonValue
}

/** Persisted outcome from one completed tool execution. */
export type ToolCallOutcomeRecord = ToolCallSuccessRecord | ToolCallFailureRecord

/** Version-one local record for one final `tools/result` observation. */
export interface ToolCallRecord {
  readonly schemaVersion: 1
  /** Monotonic sequence within valid records already stored for this Session. */
  readonly sequence: number
  /** Completion time observed by this plugin. */
  readonly completedAt: string
  readonly sessionId: string
  readonly callId: string
  readonly rootCallId: string
  readonly toolName: string
  /** Whether this execution was nested under a transport call such as PTC `run_code`. */
  readonly dispatch: 'root' | 'nested'
  readonly input: JsonValue
  readonly output: ToolCallOutcomeRecord
}

/** Aggregated counters for one tool name in a Session. */
export interface ToolCallCount {
  readonly name: string
  readonly calls: number
  readonly successes: number
  readonly failures: number
}

/** Version-one summary rebuilt from stored call records and replaced after each completed write. */
export interface ToolCallSummary {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly updatedAt: string
  readonly totalCalls: number
  readonly totalSuccesses: number
  readonly totalFailures: number
  /** Tool counters sorted by tool name for stable readers and diffs. */
  readonly tools: readonly ToolCallCount[]
}

/** Whole-Session tool-call counters projected to the selected browser Session. */
export interface ToolCallStatsProjection {
  readonly updatedAt: number | null
  readonly totalCalls: number
  readonly totalSuccesses: number
  readonly totalFailures: number
  readonly tools: readonly ToolCallCount[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Tool-call counts for one Session; omitted from Session list summaries. */
    toolCallStats: SessionProjectionSummaryExcluded<ToolCallStatsProjection>
  }
}
