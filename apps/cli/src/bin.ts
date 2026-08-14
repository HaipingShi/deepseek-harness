#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'

/**
 * The family Node floor, mirrored from package.json `engines`. npm treats
 * engines as a warning, so an unsupported Node still reaches dispatch and dies
 * deep inside plugin loading on `node:zlib`'s missing zstd exports — an error
 * that names no Node version at all. Checked before anything else, so the
 * message an unsupported user sees names the fix. Keep the predicate in sync
 * with the engines range; check-workspace-constraints keeps the manifest side.
 */
const REQUIRED_NODE_RANGE = '^22.19.0 || >=24.0.0'
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (!((nodeMajor === 22 && nodeMinor >= 19) || nodeMajor >= 24)) {
  console.error(`error: dsh requires Node ${REQUIRED_NODE_RANGE}, found ${process.versions.node}; upgrade Node and retry`)
  process.exit(1)
}

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const invocation = parseDshArgs(process.argv.slice(2), readVersion())

switch (invocation.mode) {
  case 'profile': {
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
