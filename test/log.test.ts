import { expect, test, vi } from 'vitest'

import { withProjectName } from '../src/log.ts'

function captureStdout() {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  })
  return { chunks, restore: () => spy.mockRestore() }
}

test('labels orval log lines that lost their project name', async () => {
  const { chunks, restore } = captureStdout()

  await withProjectName('pets', async () => {
    process.stdout.write('undefined Cleaning output folder\n')
  })
  restore()

  expect(chunks).toEqual(['pets Cleaning output folder\n'])
})

test('leaves every other line alone', async () => {
  const { chunks, restore } = captureStdout()

  await withProjectName('pets', async () => {
    process.stdout.write('🎉 Pets - done\n')
    process.stdout.write(Buffer.from('binary\n'))
  })
  restore()

  expect(chunks).toEqual(['🎉 Pets - done\n', 'binary\n'])
})

test('restores the stream, including when generation throws', async () => {
  const write = process.stdout.write

  await expect(
    withProjectName('pets', async () => {
      throw new Error('spec is broken')
    }),
  ).rejects.toThrow('spec is broken')

  expect(process.stdout.write).toBe(write)
})
