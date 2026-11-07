/** Browser plugin contributing the current Session's tool-call dashboard. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ToolCallDashboard } from './ToolCallDashboard.tsx'
import { en, NS, zh } from './locales.ts'

/** Required browser services: locale ownership and the conversation View slot. */
export const inject = ['slots', 'locale']

/**
 * Register the localized Tool calls tab.
 * @param ctx - browser root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'tool-call-recorder: dashboard dictionaries',
  )
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'tool-call-stats',
    order: 45,
    locale: NS,
    label: () => t('view.toolCalls'),
  }, ToolCallDashboard))
}
