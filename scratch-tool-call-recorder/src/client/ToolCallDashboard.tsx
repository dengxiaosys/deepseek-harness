/** Current-Session tool-call count dashboard. */

import type { ReactElement } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconGaugeOutlineRegular,
  IconLoadingOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../types.ts'
import { NS } from './locales.ts'
import css from './dashboard.module.css'

/** Props supplied by the Session-scoped conversation View slot. */
export type ToolCallDashboardProps = ConvViewProps & PropsLocale<typeof NS>

function successRate(calls: number, successes: number): number {
  return calls === 0 ? 0 : Math.round((successes / calls) * 100)
}

/**
 * Render counters for the Session selected by the existing conversation shell.
 * @param props - standard conversation View shares and this plugin's translator.
 * @returns loading, empty, or populated statistics for exactly one Session.
 */
export function ToolCallDashboard({ useProjection, t }: ToolCallDashboardProps): ReactElement {
  const stats = useProjection('toolCallStats')
  if (stats === undefined) {
    return (
      <div className={css.root}>
        <div className={css.loading} role="status" aria-label={t('loading')}>
          <IconLoadingOutlineRegular size={20} />
        </div>
      </div>
    )
  }

  const tools = [...stats.tools].sort((left, right) =>
    right.calls - left.calls || left.name.localeCompare(right.name))
  const updated = stats.updatedAt === null ? null : new Date(stats.updatedAt).toLocaleString()

  return (
    <div className={css.root}>
      <div className={css.scroll}>
        <header className={css.header}>
          <div>
            <h2 className={css.title}>{t('title')}</h2>
            <p className={css.scope}>{t('scope.current')}</p>
          </div>
          {updated !== null && <span className={css.updated}>{t('updated', { time: updated })}</span>}
        </header>

        <section className={css.metrics} aria-label={t('title')}>
          <div className={css.metric}>
            <span className={css.metricLabel}>{t('metric.total')}</span>
            <strong className={css.metricValue}>{stats.totalCalls}</strong>
          </div>
          <div className={css.metric}>
            <span className={css.metricLabel}>{t('metric.successes')}</span>
            <strong className={css.successValue}>{stats.totalSuccesses}</strong>
          </div>
          <div className={css.metric}>
            <span className={css.metricLabel}>{t('metric.failures')}</span>
            <strong className={css.failureValue}>{stats.totalFailures}</strong>
          </div>
        </section>

        {tools.length === 0
          ? (
              <div className={css.empty}>
                <IconGaugeOutlineRegular size={24} />
                <strong>{t('empty.title')}</strong>
                <span>{t('empty.description')}</span>
              </div>
            )
          : (
              <table className={css.table}>
                <thead>
                  <tr>
                    <th>{t('column.tool')}</th>
                    <th>{t('column.calls')}</th>
                    <th>{t('column.successes')}</th>
                    <th>{t('column.failures')}</th>
                    <th>{t('column.rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => {
                    const rate = successRate(tool.calls, tool.successes)
                    return (
                      <tr key={tool.name}>
                        <td className={css.toolCell} data-label={t('column.tool')}>
                          <code>{tool.name}</code>
                        </td>
                        <td data-label={t('column.calls')}>{tool.calls}</td>
                        <td className={css.successCell} data-label={t('column.successes')}>{tool.successes}</td>
                        <td className={css.failureCell} data-label={t('column.failures')}>{tool.failures}</td>
                        <td className={css.rateCell} data-label={t('column.rate')}>
                          <span>{rate}%</span>
                          <span className={css.rateTrack} aria-hidden="true">
                            <span className={css.rateFill} style={{ width: `${rate}%` }} />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
      </div>
    </div>
  )
}
