/** Build a distributable desktop bundle without exposing local source paths. */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

async function run(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(pnpmBin(), args, { cwd: root, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(
        code === null
          ? `pnpm ${args.join(' ')} stopped by signal ${signal ?? 'unknown'}`
          : `pnpm ${args.join(' ')} failed with exit code ${code}`,
      ))
    })
  })
}

function distributableCargoEnv(): NodeJS.ProcessEnv {
  const inherited = process.env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f')
    ?? process.env.RUSTFLAGS?.trim().split(/\s+/).filter(Boolean)
    ?? []
  const env = { ...process.env }
  delete env.RUSTFLAGS
  env.CARGO_ENCODED_RUSTFLAGS = [
    ...inherited,
    `--remap-path-prefix=${root}=dsh-source`,
    `--remap-path-prefix=${homedir()}=user-home`,
  ].join('\x1f')
  return env
}

await run(['run', 'build'])
await run(['run', 'build:desktop-sidecar', '--skip-build'])
await run(['exec', 'tauri', 'build'], distributableCargoEnv())
