/**
 * Records final tool inputs, outputs, and per-tool Session counts in a private
 * local directory without changing tool execution outcomes.
 *
 * @module dsh-tool-call-recorder
 */

import type {} from '@deepseek-ai/dsh-agent'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import { ToolCallRecorder } from './recorder.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-call-recorder'

/** Tool results and Agent disposal define the recorder's complete lifecycle. */
export const inject = ['agents', 'tools']

/** Private local output directory selected by the deployment. */
export interface Config {
  /**
   * Absolute dedicated directory for per-Session call records and summaries.
   * Missing directories are created with owner-only permissions; existing
   * directory permissions remain the deployment owner's responsibility.
   */
  outputDirectory: string
}

/** Loader validation for {@link Config}. */
export const Config: z<Config> = z.object({
  outputDirectory: z.string().required(),
})

/**
 * Register the final-result observer and drain accepted writes on unload.
 * Persistence failures are warned and contained; they never rewrite or fail
 * the already-final tool result.
 * @param ctx - plugin context carrying Agent and tool events.
 * @param config - validated output directory.
 * @returns after the output directory is ready and listeners are active.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.outputDirectory.length === 0 || !isAbsolute(config.outputDirectory)) {
    throw new Error('tool-call-recorder: outputDirectory must be a non-empty absolute path')
  }
  const recorder = new ToolCallRecorder(
    config.outputDirectory,
    (message, error) => { ctx.logger.warn(message, error) },
  )
  await recorder.initialize()

  // The close disposer is collected first. Reverse disposal removes both
  // listeners before the recorder drains accepted writes.
  ctx.effect(function* () {
    yield async () => { await recorder.close() }
    ctx.on('agent/disposed', ({ agent }) => { recorder.release(agent.id) })
    ctx.on('tools/result', (exec, result) => {
      recorder.record(exec, result)
    })
  }, 'tool-call-recorder lifecycle')
}
