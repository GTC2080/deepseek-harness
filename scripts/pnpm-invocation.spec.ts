import { afterEach, describe, expect, it } from 'vitest'
import { pnpmInvocation } from './pnpm-invocation.ts'

const originalEntrypoint = process.env.npm_execpath

afterEach(() => {
  if (originalEntrypoint === undefined) Reflect.deleteProperty(process.env, 'npm_execpath')
  else process.env.npm_execpath = originalEntrypoint
})

describe('pnpmInvocation', () => {
  it('runs the active pnpm JavaScript entrypoint through Node', () => {
    process.env.npm_execpath = 'C:\\pnpm\\bin\\pnpm.cjs'
    expect(pnpmInvocation(['run', 'build'])).toEqual({
      command: process.execPath,
      args: ['C:\\pnpm\\bin\\pnpm.cjs', 'run', 'build'],
    })
  })

  it('rejects a direct launch with no package-manager entrypoint', () => {
    Reflect.deleteProperty(process.env, 'npm_execpath')
    expect(() => pnpmInvocation(['run', 'build'])).toThrow('invoke this script through a pnpm package script')
  })
})
