import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const SPEC = `openapi: 3.0.0
info:
  title: Pets
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
`

export const SPEC_WITH_EXTRA_OPERATION = `${SPEC}  /pets/{petId}:
    get:
      operationId: showPetById
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: ok
`

const CONFIG = `export default {
  pets: {
    input: { target: './petstore.yaml' },
    output: { target: './src/pets.ts', client: 'fetch', mode: 'single' },
  },
}
`

export interface Fixture {
  root: string
  specFile: string
  outputFile: string
  writeSpec: (contents: string) => Promise<void>
  read: (file: string) => Promise<string>
  cleanup: () => Promise<void>
}

export async function createFixture(files: Record<string, string> = {}): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-orval-'))
  const write = async (file: string, contents: string) => {
    const target = path.join(root, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, contents)
  }

  await write('petstore.yaml', SPEC)
  await write('orval.config.ts', CONFIG)
  await write('src/main.ts', `export const ready = true\n`)
  for (const [file, contents] of Object.entries(files)) await write(file, contents)

  return {
    root,
    specFile: path.join(root, 'petstore.yaml'),
    outputFile: path.join(root, 'src/pets.ts'),
    writeSpec: (contents) => write('petstore.yaml', contents),
    read: (file) => fs.readFile(path.join(root, file), 'utf8'),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

export async function waitFor(
  assertion: () => Promise<void> | void,
  { timeout = 20_000, interval = 100 } = {},
): Promise<void> {
  const deadline = Date.now() + timeout
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => {
        setTimeout(resolve, interval)
      })
    }
  }

  throw lastError
}
