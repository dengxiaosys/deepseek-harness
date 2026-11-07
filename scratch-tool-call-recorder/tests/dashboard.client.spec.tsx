// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ToolCallStatsProjection } from '../src/types.ts'
import {
  ToolCallDashboard,
  type ToolCallDashboardProps,
} from '../src/client/ToolCallDashboard.tsx'
import { en, type ToolCallRecorderKey } from '../src/client/locales.ts'

function props(value: ToolCallStatsProjection | undefined): ToolCallDashboardProps {
  const useProjection: ToolCallDashboardProps['useProjection'] = ((
    _key: string,
    selector?: (candidate: ToolCallStatsProjection | undefined) => unknown,
  ) => selector === undefined ? value : selector(value)) as ToolCallDashboardProps['useProjection']
  const t: ToolCallDashboardProps['t'] = ((
    key: ToolCallRecorderKey,
    params?: Readonly<Record<string, string | number>>,
  ) => {
    const template = en[key]
    return Object.entries(params ?? {}).reduce(
      (text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)),
      template,
    )
  }) as ToolCallDashboardProps['t']
  return { useProjection, t } as ToolCallDashboardProps
}

describe('tool call dashboard', () => {
  it('shows the selected Session totals and per-tool rates', () => {
    render(<ToolCallDashboard {...props({
      updatedAt: Date.UTC(2026, 10, 4, 3, 0, 0),
      totalCalls: 4,
      totalSuccesses: 3,
      totalFailures: 1,
      tools: [
        { name: 'write', calls: 1, successes: 1, failures: 0 },
        { name: 'read', calls: 3, successes: 2, failures: 1 },
      ],
    })} />)

    expect(screen.getByText('Tool call overview')).toBeTruthy()
    expect(screen.getByText('read')).toBeTruthy()
    expect(screen.getByText('write')).toBeTruthy()
    expect(screen.getByText('67%')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('shows a stable empty state before the Session calls a tool', () => {
    render(<ToolCallDashboard {...props({
      updatedAt: null,
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      tools: [],
    })} />)

    expect(screen.getByText('No tool calls yet')).toBeTruthy()
  })

  it('shows one page-level loading treatment before the projection arrives', () => {
    render(<ToolCallDashboard {...props(undefined)} />)

    expect(screen.getByRole('status', { name: 'Loading tool call statistics' })).toBeTruthy()
  })
})
