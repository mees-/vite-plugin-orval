/** Prefix orval leaves behind when it has no project name to interpolate. */
const UNNAMED_PROJECT_PREFIX = 'undefined '

/**
 * Orval interpolates the project name into its cleaning log unconditionally,
 * but its public `generate()` only forwards a name when it is handed a config
 * path, not a config object — leaving `undefined Cleaning output folder`. Its
 * logger captured `console.log` at import time, so the line can only be
 * relabelled at the stream. Drop this once orval guards the interpolation.
 */
export async function withProjectName<T>(name: string, run: () => Promise<T>): Promise<T> {
  const { stdout } = process
  const write = stdout.write

  stdout.write = function (this: NodeJS.WriteStream, chunk: unknown, ...rest: unknown[]) {
    const relabelled =
      typeof chunk === 'string' && chunk.startsWith(UNNAMED_PROJECT_PREFIX)
        ? `${name} ${chunk.slice(UNNAMED_PROJECT_PREFIX.length)}`
        : chunk
    return Reflect.apply(write, this, [relabelled, ...rest])
  } as typeof stdout.write

  try {
    return await run()
  } finally {
    stdout.write = write
  }
}
