/** Resolve the active pnpm JavaScript entrypoint without a platform shell. */
export function pnpmInvocation(args: string[]): { command: string; args: string[] } {
  const entrypoint = process.env.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error('npm_execpath is unavailable; invoke this script through a pnpm package script.')
  }
  // Windows cannot spawn the pnpm.cmd shim directly; the JavaScript entrypoint works on every host.
  return { command: process.execPath, args: [entrypoint, ...args] }
}
