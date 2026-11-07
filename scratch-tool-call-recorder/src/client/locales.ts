/** Locale-owned copy for the tool-call dashboard. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'toolCallRecorder'

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  'view.toolCalls': '工具调用',
  'title': '工具调用概览',
  'scope.current': '当前会话',
  'updated': '更新于 {time}',
  'loading': '正在加载工具调用统计',
  'metric.total': '总调用',
  'metric.successes': '成功',
  'metric.failures': '失败',
  'column.tool': '工具',
  'column.calls': '调用',
  'column.successes': '成功',
  'column.failures': '失败',
  'column.rate': '成功率',
  'empty.title': '还没有工具调用',
  'empty.description': '当前会话完成工具调用后，统计会自动显示在这里',
} as const

/** Dashboard dictionary key union. */
export type ToolCallRecorderKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Tool-call count dashboard copy. */
    toolCallRecorder: ToolCallRecorderKey
  }
}

/** English dictionary; other locales fall back to English. */
export const en: Record<ToolCallRecorderKey, string> = {
  'view.toolCalls': 'Tool calls',
  'title': 'Tool call overview',
  'scope.current': 'Current session',
  'updated': 'Updated {time}',
  'loading': 'Loading tool call statistics',
  'metric.total': 'Total calls',
  'metric.successes': 'Successful',
  'metric.failures': 'Failed',
  'column.tool': 'Tool',
  'column.calls': 'Calls',
  'column.successes': 'Successful',
  'column.failures': 'Failed',
  'column.rate': 'Success rate',
  'empty.title': 'No tool calls yet',
  'empty.description': 'Statistics appear here after the current session completes a tool call',
}
