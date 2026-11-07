// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { en, type ToolCallRecorderKey } from '../src/client/locales.ts'
import { apply, inject } from '../src/client/index.ts'

function translate(key: ToolCallRecorderKey): string {
  return en[key]
}

describe('tool call dashboard client plugin', () => {
  it('registers and disposes the localized conversation View', async () => {
    const ctx = new Context()
    const entries: { options: { id?: string; label?: string | (() => string) } }[] = []
    ctx.provide('slots', {
      inject: (_name: string, register: () => () => void) => { ctx.effect(register) },
      register: (options: { id?: string; label?: string | (() => string) }) => {
        const entry = { options }
        entries.push(entry)
        return () => { entries.splice(entries.indexOf(entry), 1) }
      },
    } as never)
    const disposeLocale = vi.fn()
    ctx.provide('locale', {
      register: vi.fn(() => disposeLocale),
      bind: () => translate,
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = entries[0]
    expect(entry?.options.id).toBe('tool-call-stats')
    const label = entry?.options.label
    expect(typeof label === 'function' ? label() : label).toBe('Tool calls')

    await fiber.dispose()
    expect(disposeLocale).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
    expect(entries).toEqual([])
  })
})
