/**
 * Build the native-host DeepSeek Harness sidecar consumed by Tauri. The
 * deployed production closure is compiled into one Node SEA executable so the
 * desktop application does not require a system Node.js installation.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const STAGING = resolve(root, '.artifacts/desktop-sidecar/node')
const BINARIES = resolve(root, 'src-tauri/binaries')
const WORKSPACE_MODULES = resolve(root, 'node_modules/.pnpm/node_modules')
const DEPLOY_PACKAGE = '@deepseek-ai/dsh'
const ENTRY_BIN = 'lib/bin.js'
const PKG_SPEC = '@yao-pkg/pkg@6.21.0'

const ASSET_GLOBS = [
  'package.json',
  'config/**/*',
  'lib/**/*.js',
  'node_modules/**/*.js',
  'node_modules/**/*.cjs',
  'node_modules/**/*.mjs',
  'node_modules/**/package.json',
  'node_modules/**/*.json',
  'node_modules/**/*.node',
  'node_modules/**/*.dylib',
  'node_modules/**/*.so',
  'node_modules/**/*.so.*',
  'node_modules/**/*.dll',
  'node_modules/**/*.exe',
  'node_modules/**/*.wasm',
  'node_modules/**/*.yml',
  'node_modules/**/*.yaml',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/**/*',
]

interface HostTarget {
  readonly pkgTarget: string
  readonly rustTriple: string
  readonly nodePtyPlatform: string
  readonly executableSuffix: string
}

interface Cli {
  readonly skipBuild: boolean
  readonly dryRun: boolean
}

interface PackageManifest {
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>
  readonly [key: string]: unknown
}

function usage(): string {
  return [
    'Usage: pnpm run build:desktop-sidecar [flags]',
    '',
    '  --skip-build  skip `pnpm run build` (lib/ and apps/web/dist must already exist).',
    '  --dry-run     print commands and filesystem changes without executing them.',
    '  --help        print this help.',
    '',
    'The sidecar is built for the current native host only.',
  ].join('\n')
}

function parseCli(argv: string[]): Cli {
  let values: ReturnType<typeof parseArgs>['values']
  try {
    values = parseArgs({
      args: argv,
      options: {
        'skip-build': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}`)
  }
  if (values.help) {
    console.log(usage())
    process.exit(0)
  }
  return {
    skipBuild: values['skip-build'] === true,
    dryRun: values['dry-run'] === true,
  }
}

function resolveHostTarget(): HostTarget {
  const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined
  if (arch === undefined) {
    throw new Error(`unsupported host architecture ${process.arch}; supported architectures are x64 and arm64.`)
  }
  if (process.platform === 'darwin') {
    return {
      pkgTarget: `node24-macos-${arch}`,
      rustTriple: arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin',
      nodePtyPlatform: `darwin-${arch}`,
      executableSuffix: '',
    }
  }
  if (process.platform === 'win32') {
    return {
      pkgTarget: `node24-win-${arch}`,
      rustTriple: arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc',
      nodePtyPlatform: `win32-${arch}`,
      executableSuffix: '.exe',
    }
  }
  throw new Error(`unsupported host platform ${process.platform}; desktop builds require macOS or Windows.`)
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

function containedPackagePath(directory: string, dependency: string): string {
  const root = resolve(directory)
  const candidate = resolve(root, dependency)
  if (candidate === root || !candidate.startsWith(root + sep)) {
    throw new Error(`invalid dependency name ${JSON.stringify(dependency)}: resolved outside ${root}.`)
  }
  return candidate
}

async function run(label: string, command: string, args: string[], dryRun: boolean): Promise<void> {
  const printable = formatCommand(command, args)
  if (dryRun) {
    console.log(`build-desktop-sidecar: [dry-run] ${printable}`)
    return
  }
  console.log(`build-desktop-sidecar: ${label}: ${printable}`)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
    })
    child.once('error', (error) => {
      reject(new Error(`${label} failed to spawn: ${error.message} (${printable})`))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
      reject(new Error(`${label} failed (${cause}): ${printable}`))
    })
  })
}

async function removeBinDirectories(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name === '.bin') {
      await rm(path, { recursive: true, force: true })
      continue
    }
    if (entry.isDirectory()) await removeBinDirectories(path)
  }
}

async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function deploy(cli: Cli): Promise<void> {
  if (STAGING === root || root.startsWith(STAGING + sep)) {
    throw new Error(`refusing to clear staging directory ${STAGING}: it contains the repository root.`)
  }
  if (cli.dryRun) console.log(`build-desktop-sidecar: [dry-run] clear ${STAGING}`)
  else await rm(STAGING, { recursive: true, force: true })
  await run('deploy', pnpmBin(), [
    '--filter',
    DEPLOY_PACKAGE,
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    STAGING,
  ], cli.dryRun)
  if (cli.dryRun) {
    console.log(`build-desktop-sidecar: [dry-run] restore the dependency and required-peer closure from ${WORKSPACE_MODULES}`)
    console.log(`build-desktop-sidecar: [dry-run] remove .bin directories below ${STAGING}`)
    return
  }
  await restoreRuntimeClosure()
  await removeBinDirectories(STAGING)
  const link = await findSymlink(STAGING)
  if (link !== undefined) throw new Error(`staged production closure still contains a symbolic link: ${link}`)
}

async function restoreRuntimeClosure(): Promise<void> {
  const queue = [STAGING]
  const visited = new Set<string>()
  const restored: string[] = []
  for (let packageDir = queue.shift(); packageDir !== undefined; packageDir = queue.shift()) {
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as PackageManifest
    const required = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {})
        .filter(name => manifest.peerDependenciesMeta?.[name]?.optional !== true),
    ])
    for (const dependency of [...required].sort()) {
      if (visited.has(dependency)) continue
      visited.add(dependency)
      const destination = containedPackagePath(join(STAGING, 'node_modules'), dependency)
      if (!existsSync(destination)) {
        const source = containedPackagePath(WORKSPACE_MODULES, dependency)
        if (!existsSync(source)) {
          throw new Error(`required runtime package ${dependency} is absent from the deployed closure and ${WORKSPACE_MODULES}.`)
        }
        await mkdir(dirname(destination), { recursive: true })
        const nestedNodeModules = join(source, 'node_modules')
        await cp(source, destination, {
          recursive: true,
          dereference: true,
          filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
        })
        restored.push(dependency)
      }
      queue.push(destination)
    }
  }
  if (restored.length > 0) {
    console.log(`build-desktop-sidecar: restored ${restored.length} dependency-closure packages`)
  }
}

async function injectPkgConfig(cli: Cli): Promise<void> {
  const manifestPath = join(STAGING, 'package.json')
  const patch = { bin: ENTRY_BIN, pkg: { assets: ASSET_GLOBS } }
  if (cli.dryRun) {
    console.log(`build-desktop-sidecar: [dry-run] patch ${manifestPath} with ${JSON.stringify(patch)}`)
    return
  }
  if (!existsSync(join(STAGING, ENTRY_BIN))) {
    throw new Error(`${join(STAGING, ENTRY_BIN)} is missing; run without --skip-build so compiled artifacts exist.`)
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`)
}

async function buildSidecar(cli: Cli, target: HostTarget): Promise<string[]> {
  const executable = join(BINARIES, `dsh-backend-${target.rustTriple}${target.executableSuffix}`)
  if (!cli.dryRun) await mkdir(BINARIES, { recursive: true })
  await run('pkg', pnpmBin(), [
    'dlx',
    '--allow-build=esbuild',
    PKG_SPEC,
    STAGING,
    '--sea',
    '--targets',
    target.pkgTarget,
    '--output',
    executable,
  ], cli.dryRun)
  const products = [executable]
  if (process.platform === 'darwin') {
    const source = join(STAGING, 'node_modules/node-pty/prebuilds', target.nodePtyPlatform, 'spawn-helper')
    const helper = join(BINARIES, `dsh-backend-spawn-helper-${target.rustTriple}`)
    if (cli.dryRun) console.log(`build-desktop-sidecar: [dry-run] copy ${source} to ${helper}`)
    else {
      if (!existsSync(source)) throw new Error(`node-pty spawn helper is missing: ${source}`)
      await copyFile(source, helper)
      await chmod(helper, 0o755)
    }
    products.push(helper)
  }
  return products
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2))
  const target = resolveHostTarget()
  console.log(`build-desktop-sidecar: native target ${target.rustTriple} (${target.pkgTarget})`)
  if (!cli.skipBuild) await run('build', pnpmBin(), ['run', 'build'], cli.dryRun)
  await deploy(cli)
  await injectPkgConfig(cli)
  const products = await buildSidecar(cli, target)
  console.log(cli.dryRun ? 'build-desktop-sidecar: [dry-run] would produce:' : 'build-desktop-sidecar: products:')
  for (const path of products) {
    if (cli.dryRun) console.log(`  ${path}`)
    else console.log(`  ${path} (${(statSync(path).size / (1024 * 1024)).toFixed(1)} MB)`)
  }
}

await main()
