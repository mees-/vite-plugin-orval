import path from 'node:path'
import process from 'node:process'

import type { Config, GlobalOptions, OptionsExport } from 'orval'
import picomatch from 'picomatch'
import { normalizePath } from 'vite'
import type { Logger, Plugin, ViteDevServer } from 'vite'

import { loadConfig, resolveWatchPaths } from './config.ts'

const PLUGIN_NAME = 'vite-plugin-orval'
const DEFAULT_DEBOUNCE_MS = 200

export interface OrvalPluginOptions {
  /**
   * Path to the orval config file (resolved against `root`), or an inline orval
   * config. Defaults to the first `orval.config.*` file found in `root`.
   */
  config?: string | Config | OptionsExport
  /** Only generate these projects of the config. Defaults to all of them. */
  projects?: string[]
  /**
   * Files to watch. `true` watches every local input target of the config (plus
   * the config file itself), `false` disables watching. A path or glob replaces
   * the auto-detected input targets, which is how you watch a spec split over
   * several `$ref`'d files.
   *
   * @default true
   */
  watch?: boolean | string | string[]
  /** Which vite commands the plugin runs in. @default 'both' */
  apply?: 'serve' | 'build' | 'both'
  /**
   * Generate once when the dev server starts or a build begins. Disable to only
   * regenerate on spec changes.
   *
   * @default true
   */
  generateOnStart?: boolean
  /**
   * Fail the build, or the dev server startup, when generation fails.
   *
   * @default true during `vite build`, false during `vite dev`
   */
  failOnError?: boolean
  /** Show generation errors in the dev server error overlay. @default true */
  overlay?: boolean
  /** Milliseconds to wait for further changes before regenerating. @default 200 */
  debounce?: number
  /** Directory the config file is resolved against. @default vite's `root` */
  root?: string
  /** Orval global options, the programmatic equivalent of its CLI flags. */
  globalOptions?: Omit<GlobalOptions, 'watch' | 'throwOnError'>
}

export function orval(pluginOptions: OrvalPluginOptions = {}): Plugin {
  const {
    projects,
    watch = true,
    apply = 'both',
    generateOnStart = true,
    overlay = true,
    debounce = DEFAULT_DEBOUNCE_MS,
  } = pluginOptions

  let root = process.cwd()
  let logger: Logger
  let isBuild = false
  let server: ViteDevServer | undefined
  let watchPaths: string[] = []
  const watchedTargets = new Set<string>()
  let isWatched: ((file: string) => boolean) | undefined

  let running: Promise<void> | undefined
  let rerunRequested = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let overlayShown = false

  async function generate(): Promise<void> {
    const config = await loadConfig(pluginOptions.config, root, projects)
    watchPaths = resolveWatchPaths(config, watch)

    syncWatcher()

    const { generate: orvalGenerate } = await import('orval')
    const globalOptions: GlobalOptions = { ...pluginOptions.globalOptions, throwOnError: true }

    for (const project of config.projects) {
      logger.info(`[${PLUGIN_NAME}] generating ${project.name}`, { timestamp: true })
      await orvalGenerate(project.options, config.workspace, globalOptions)
    }
  }

  /** Runs orval without ever overlapping runs, coalescing requests made while busy. */
  async function run(): Promise<void> {
    if (running) {
      rerunRequested = true
      return running
    }

    running = generate().finally(() => {
      running = undefined
    })

    try {
      await running
      clearOverlay()
    } finally {
      if (rerunRequested) {
        rerunRequested = false
        await run()
      }
    }
  }

  function scheduleRun(): void {
    clearTimeout(timer)
    timer = setTimeout(() => {
      run().catch(reportError)
    }, debounce)
    timer.unref?.()
  }

  /** Keeps the dev server watcher in sync with the inputs of the current config. */
  function syncWatcher(): void {
    if (!server) return

    isWatched = picomatch(watchPaths, { dot: true })
    for (const pattern of watchPaths) {
      // Chokidar 4 (vite 6+) dropped glob support, so watch the static base of
      // the pattern and match events against the pattern itself.
      const { base, isGlob } = picomatch.scan(pattern)
      const target = isGlob ? base : pattern
      if (watchedTargets.has(target)) continue
      watchedTargets.add(target)
      server.watcher.add(target)
    }
  }

  function reportError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error(`[${PLUGIN_NAME}] generation failed: ${err.message}`, {
      timestamp: true,
      error: err,
    })

    if (overlay && server) {
      overlayShown = true
      server.hot.send({
        type: 'error',
        err: { message: err.message, stack: err.stack ?? '', plugin: PLUGIN_NAME },
      })
    }
  }

  function clearOverlay(): void {
    if (!overlayShown || !server) return
    overlayShown = false
    server.hot.send({ type: 'full-reload' })
  }

  return {
    name: PLUGIN_NAME,
    apply: apply === 'both' ? undefined : apply,
    // Generated modules have to exist before anything resolves them.
    enforce: 'pre',

    configResolved(config) {
      root = pluginOptions.root ? path.resolve(config.root, pluginOptions.root) : config.root
      logger = config.logger
      isBuild = config.command === 'build'
    },

    configureServer(devServer) {
      server = devServer
      if (watch === false) return

      const handleEvent = (file: string) => {
        if (isWatched?.(normalizePath(file))) scheduleRun()
      }
      devServer.watcher.on('add', handleEvent)
      devServer.watcher.on('change', handleEvent)
      devServer.watcher.on('unlink', handleEvent)
    },

    async buildStart() {
      if (generateOnStart) {
        try {
          await run()
        } catch (error) {
          if (pluginOptions.failOnError ?? isBuild) throw error
          reportError(error)
        }
      } else {
        // Loaded anyway: it is what tells us which files to watch.
        watchPaths = resolveWatchPaths(
          await loadConfig(pluginOptions.config, root, projects),
          watch,
        )
        syncWatcher()
      }

      // `vite build --watch`: rollup reruns `buildStart` on every change.
      if (!server) {
        for (const file of watchPaths) {
          if (!picomatch.scan(file).isGlob) this.addWatchFile(file)
        }
      }
    },

    buildEnd() {
      clearTimeout(timer)
    },
  }
}

export default orval
