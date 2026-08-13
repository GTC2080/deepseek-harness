import { afterEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ spawn: vi.fn(() => ({ pid: 7 })) }))
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }))

import { spawnDialogWorker } from '../src/win32-dialog-host.ts'

const originalPkg = Object.getOwnPropertyDescriptor(process, 'pkg')

afterEach(() => {
  mocked.spawn.mockClear()
  if (originalPkg === undefined) Reflect.deleteProperty(process, 'pkg')
  else Object.defineProperty(process, 'pkg', originalPkg)
})

describe('spawnDialogWorker', () => {
  it('re-enters a pkg/SEA sidecar through its private worker mode', () => {
    Object.defineProperty(process, 'pkg', { configurable: true, value: {} })

    spawnDialogWorker({ title: 'Workspace picker test' })

    const [command, args, options] = mocked.spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv; stdio: string[]; windowsHide: boolean },
    ]
    expect(command).toBe(process.execPath)
    expect(args).toEqual(['--dsh-internal-win32-dialog-worker'])
    expect(options.env.DSH_DIALOG_TITLE).toBe('Workspace picker test')
    expect(options.stdio).toEqual(['ignore', 'inherit', 'inherit', 'ipc'])
    expect(options.windowsHide).toBe(true)
  })
})
