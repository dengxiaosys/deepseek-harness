import { statfs } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-disk-space-plugin'
export const inject = ['tools']

export interface Config {
  /** Absolute host path whose filesystem capacity the tool reports. */
  path: string
}

export const Config: Schema<Config> = Schema.object({
  path: Schema.string().required(),
})

export interface DiskSpaceValue {
  path: string
  totalBytes: string
  usedBytes: string
  freeBytes: string
  availableBytes: string
}

const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const

function formatBytes(bytes: bigint): string {
  let divisor = 1n
  let unit = 0
  while (bytes >= divisor * 1024n && unit < BINARY_UNITS.length - 1) {
    divisor *= 1024n
    unit += 1
  }
  if (unit === 0) return `${String(bytes)} ${BINARY_UNITS[unit]}`
  const whole = bytes / divisor
  const decimal = bytes % divisor * 10n / divisor
  return `${String(whole)}.${String(decimal)} ${BINARY_UNITS[unit]}`
}

/** Read exact capacity values without invoking a shell or subprocess. */
export async function readDiskSpace(path: string, signal?: AbortSignal): Promise<DiskSpaceValue> {
  signal?.throwIfAborted()
  const stats = await statfs(path, { bigint: true })
  signal?.throwIfAborted()

  const totalBytes = stats.blocks * stats.bsize
  const freeBytes = stats.bfree * stats.bsize
  const availableBytes = stats.bavail * stats.bsize
  return {
    path,
    totalBytes: String(totalBytes),
    usedBytes: String(totalBytes - freeBytes),
    freeBytes: String(freeBytes),
    availableBytes: String(availableBytes),
  }
}

export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.path)) {
    throw new Error('disk-space-tool: path must be absolute')
  }

  ctx.tools.register(defineTool({
    name: 'disk_space',
    description: 'Report total, used, free, and user-available capacity for the configured host filesystem.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          totalBytes: { type: 'string', required: true },
          usedBytes: { type: 'string', required: true },
          freeBytes: { type: 'string', required: true },
          availableBytes: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Filesystem for ${value.path}:`,
          `total=${formatBytes(BigInt(value.totalBytes))}`,
          `used=${formatBytes(BigInt(value.usedBytes))}`,
          `free=${formatBytes(BigInt(value.freeBytes))}`,
          `available=${formatBytes(BigInt(value.availableBytes))}`,
        ].join(' '),
      }],
    },
    execute: (_args, exec) => readDiskSpace(config.path, exec.signal),
    presentCall: () => ({ card: 'generic', title: 'Read disk space', kind: 'read' }),
  }))
}
