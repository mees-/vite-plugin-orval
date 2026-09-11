# vite-plugin-orval

Run [orval](https://orval.dev) from vite. Generates your API client when the dev
server starts or a build begins, then regenerates it whenever the OpenAPI spec
changes — no second terminal, no `orval --watch` process to babysit.

- Generates before anything resolves the generated modules, so the first dev
  request and the build always see fresh output.
- Watches every local input target in your orval config (and the config file
  itself) through vite's own watcher, so HMR picks the new client up.
- Fails the build on generation errors; in dev it logs and shows the error
  overlay instead of killing the server.

## Install

```sh
npm install -D vite-plugin-orval orval
```

`orval` and `vite` are peer dependencies: orval 8, vite 5.1 through 8.

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import orval from 'vite-plugin-orval'

export default defineConfig({
  plugins: [orval()],
})
```

By default it picks up the `orval.config.ts` (or `.mts`, `.cts`, `.js`, `.mjs`,
`.cjs`) next to your vite root and generates every project in it:

```ts
// orval.config.ts
export default {
  petstore: {
    input: { target: './specs/petstore.yaml' },
    output: { target: './src/api/petstore.ts', client: 'react-query' },
  },
}
```

Paths inside the config are resolved relative to the config file, exactly like
the orval CLI does.

### Inline config

```ts
orval({
  config: {
    input: { target: './specs/petstore.yaml' },
    output: { target: './src/api/petstore.ts', client: 'fetch' },
  },
})
```

Inline paths are resolved relative to vite's `root`.

### A spec split over several files

Auto-detection watches the input target of each project. When your spec `$ref`s
sibling files, point `watch` at all of them:

```ts
orval({ watch: './specs/**/*.yaml' })
```

A custom `watch` value replaces the auto-detected targets; the config file stays
watched either way.

## Options

| Option            | Type                            | Default                  | Description                                                                                                                                     |
| ----------------- | ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`          | `string \| object`              | nearest `orval.config.*` | Path to the orval config file, or an inline orval config.                                                                                       |
| `projects`        | `string[]`                      | all                      | Only generate these projects of the config.                                                                                                     |
| `watch`           | `boolean \| string \| string[]` | `true`                   | Files to watch. `false` disables watching; a path or glob replaces the auto-detected input targets.                                             |
| `apply`           | `'serve' \| 'build' \| 'both'`  | `'both'`                 | Which vite commands the plugin runs in.                                                                                                         |
| `generateOnStart` | `boolean`                       | `true`                   | Generate once on dev server start / build start. Disable to only regenerate on change.                                                          |
| `failOnError`     | `boolean`                       | `true` on build          | Fail the build, or dev server startup, when generation fails.                                                                                   |
| `overlay`         | `boolean`                       | `true`                   | Show generation errors in the dev server error overlay.                                                                                         |
| `debounce`        | `number`                        | `200`                    | Milliseconds to wait for further changes before regenerating.                                                                                   |
| `root`            | `string`                        | vite's `root`            | Directory the config file is resolved against.                                                                                                  |
| `globalOptions`   | `object`                        | —                        | Orval global options — the programmatic equivalent of its CLI flags (`client`, `mode`, `mock`, `clean`, `formatter`, `tsconfig`, `verbose`, …). |

## Notes

- **Remote specs are not watched.** An `input.target` that is a URL is fetched
  on every generation run, but nothing local changes to trigger one. Restart the
  dev server, or touch the config file, to refetch.
- **`vite build --watch`** re-runs generation on every rebuild through rollup's
  watch files. Only concrete file paths are registered there, not globs.
- **`output.clean` deletes before it parses.** Orval empties the output folder
  before it reads the spec, so with `clean` enabled — it is off by default — a
  broken spec in dev leaves you with no generated client at all until you fix it.
  The dev server survives, but every import of the client fails to resolve, which
  looks like a resolution bug rather than a spec error. Leave `clean` off if you
  would rather keep the last good output through a failed run.
- **Generated output should not be watched.** Keep your orval `output.target`
  out of the `watch` patterns, or generation will retrigger itself.
- The plugin is ESM only, like orval itself.

## License

MIT
