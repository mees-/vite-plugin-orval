import fs from 'node:fs/promises'

import { build, createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterEach, describe, expect, test } from 'vitest'

import { orval } from '../src/index.ts'
import { SPEC_WITH_EXTRA_OPERATION, createFixture, waitFor } from './utils.ts'
import type { Fixture } from './utils.ts'

let fixture: Fixture | undefined
let server: ViteDevServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  await fixture?.cleanup()
  fixture = undefined
})

describe('dev', () => {
  test('generates before the dev server is ready and regenerates when the spec changes', async () => {
    fixture = await createFixture()

    server = await createServer({
      root: fixture.root,
      logLevel: 'silent',
      server: { middlewareMode: true },
      plugins: [orval({ debounce: 20 })],
    })

    expect(await fixture.read('src/pets.ts')).toContain('listPets')

    await fixture.writeSpec(SPEC_WITH_EXTRA_OPERATION)
    await waitFor(async () => {
      expect(await fixture!.read('src/pets.ts')).toContain('showPetById')
    })
  })

  test('regenerates when the orval config changes', async () => {
    fixture = await createFixture()

    server = await createServer({
      root: fixture.root,
      logLevel: 'silent',
      server: { middlewareMode: true },
      plugins: [orval({ debounce: 20 })],
    })

    await fs.writeFile(
      `${fixture.root}/orval.config.ts`,
      `export default {
  pets: {
    input: { target: './petstore.yaml' },
    output: { target: './src/renamed.ts', client: 'fetch', mode: 'single' },
  },
}
`,
    )

    await waitFor(async () => {
      expect(await fixture!.read('src/renamed.ts')).toContain('listPets')
    })
  })

  test('keeps the dev server running when generation fails', async () => {
    fixture = await createFixture({ 'petstore.yaml': 'not: a valid openapi document' })

    server = await createServer({
      root: fixture.root,
      logLevel: 'silent',
      server: { middlewareMode: true },
      plugins: [orval()],
    })

    expect(server.config.command).toBe('serve')
    await expect(fixture.read('src/pets.ts')).rejects.toThrow()
  })

  test('does not generate when watch-only', async () => {
    fixture = await createFixture()

    server = await createServer({
      root: fixture.root,
      logLevel: 'silent',
      server: { middlewareMode: true },
      plugins: [orval({ generateOnStart: false, debounce: 20 })],
    })

    await expect(fixture.read('src/pets.ts')).rejects.toThrow()

    await fixture.writeSpec(SPEC_WITH_EXTRA_OPERATION)
    await waitFor(async () => {
      expect(await fixture!.read('src/pets.ts')).toContain('showPetById')
    })
  })
})

describe('build', () => {
  test('generates before the bundle is built', async () => {
    fixture = await createFixture()

    await build({
      root: fixture.root,
      logLevel: 'silent',
      plugins: [orval()],
      build: { write: false, rollupOptions: { input: `${fixture.root}/src/main.ts` } },
    })

    expect(await fixture.read('src/pets.ts')).toContain('listPets')
  })

  test('fails the build when generation fails', async () => {
    fixture = await createFixture({ 'petstore.yaml': 'not: a valid openapi document' })

    await expect(
      build({
        root: fixture.root,
        logLevel: 'silent',
        plugins: [orval()],
        build: { write: false, rollupOptions: { input: `${fixture.root}/src/main.ts` } },
      }),
    ).rejects.toThrow()
  })

  test('reports unknown projects', async () => {
    fixture = await createFixture()

    await expect(
      build({
        root: fixture.root,
        logLevel: 'silent',
        plugins: [orval({ projects: ['nope'] })],
        build: { write: false, rollupOptions: { input: `${fixture.root}/src/main.ts` } },
      }),
    ).rejects.toThrow(/Orval project not found in config: nope/u)
  })
})
