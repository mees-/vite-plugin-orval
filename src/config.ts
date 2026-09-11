import fs from 'node:fs'
import path from 'node:path'

import type { Config, Options, OptionsExport } from 'orval'
import { normalizePath } from 'vite'

const CONFIG_FILE_NAMES = [
  'orval.config.ts',
  'orval.config.mts',
  'orval.config.cts',
  'orval.config.js',
  'orval.config.mjs',
  'orval.config.cjs',
]
const PROTOCOL = /^[a-z][a-z\d+.-]*:\/\//iu
const DEFAULT_PROJECT_NAME = 'orval'

export interface Project {
  name: string
  options: Options
}

export interface LoadedConfig {
  /** Directory orval resolves input and output paths against. */
  workspace: string
  configFile?: string
  projects: Project[]
}

export async function loadConfig(
  config: string | Config | OptionsExport | undefined,
  root: string,
  projectFilter: string[] | undefined,
): Promise<LoadedConfig> {
  if (config && typeof config !== 'string') {
    return {
      workspace: root,
      projects: filterProjects(await toProjects(config), projectFilter),
    }
  }

  const configFile = findConfigFile(config, root)
  return {
    workspace: path.dirname(configFile),
    configFile: normalizePath(configFile),
    projects: filterProjects(await toProjects(await importConfigFile(configFile)), projectFilter),
  }
}

/** Files whose changes should trigger a regeneration. */
export function resolveWatchPaths(
  config: LoadedConfig,
  watch: boolean | string | string[],
): string[] {
  if (watch === false) return []

  const paths = new Set<string>()
  if (config.configFile) paths.add(config.configFile)

  const patterns =
    watch === true
      ? config.projects.flatMap((project) => inputPaths(project.options))
      : toArray(watch)

  for (const pattern of patterns) {
    paths.add(normalizePath(path.resolve(config.workspace, pattern)))
  }

  return [...paths]
}

/** Local files orval reads to produce its output: the spec and its transformer. */
function inputPaths(options: Options): string[] {
  const { input } = options
  if (!input) return []

  const target = typeof input === 'string' || Array.isArray(input) ? input : input.target
  const paths = toArray(target).filter(
    (value): value is string => typeof value === 'string' && !PROTOCOL.test(value),
  )

  const transformer =
    typeof input === 'object' && !Array.isArray(input) ? input.override?.transformer : undefined
  if (typeof transformer === 'string') paths.push(transformer)

  return paths
}

function findConfigFile(configPath: string | undefined, root: string): string {
  if (configPath) {
    const resolved = path.resolve(root, configPath)
    if (!fs.existsSync(resolved)) throw new Error(`Orval config file not found: ${resolved}`)
    return resolved
  }

  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.resolve(root, name)
    if (fs.existsSync(candidate)) return candidate
  }

  throw new Error(
    `No orval config file found in ${root}. Create an orval.config.ts, or pass one through the plugin's \`config\` option.`,
  )
}

async function importConfigFile(file: string): Promise<Config | OptionsExport> {
  const { createJiti } = await import('jiti')
  // No module cache: the config is re-imported whenever it changes.
  const jiti = createJiti(file, { interopDefault: true, moduleCache: false })
  const config = await jiti.import<Config | OptionsExport>(file, { default: true })

  if (config === undefined) throw new Error(`${file} has no default export`)
  return config
}

async function toProjects(config: Config | OptionsExport): Promise<Project[]> {
  const resolved = await resolveEntry(config)

  if ('input' in resolved || 'output' in resolved) {
    return [{ name: DEFAULT_PROJECT_NAME, options: resolved as Options }]
  }

  return Promise.all(
    Object.entries(resolved as Config).map(async ([name, entry]) => ({
      name,
      options: (await resolveEntry(entry)) as Options,
    })),
  )
}

async function resolveEntry(entry: Config | OptionsExport): Promise<Config | Options> {
  return typeof entry === 'function' ? await entry() : await entry
}

function filterProjects(projects: Project[], filter: string[] | undefined): Project[] {
  if (!filter?.length) return projects

  const missing = filter.filter((name) => !projects.some((project) => project.name === name))
  if (missing.length > 0) {
    throw new Error(
      `Orval project not found in config: ${missing.join(', ')}. Available: ${projects.map((project) => project.name).join(', ')}`,
    )
  }

  return projects.filter((project) => filter.includes(project.name))
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}
