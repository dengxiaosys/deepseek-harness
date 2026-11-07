import { clientBundle } from '../packages/client/tsdown.client.ts'

const bundle = clientBundle(import.meta.dirname, ['src/index.ts', 'src/projection.ts'], {
  lib: { clean: true },
})

export default (options: Parameters<typeof bundle>[0]) =>
  bundle(options).map(config => ({
    ...config,
    tsconfig: config.name?.endsWith('/client')
      ? 'tsconfig.client.json'
      : 'tsconfig.host.json',
  }))
