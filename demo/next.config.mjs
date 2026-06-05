// Core
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')

// Load the repo-root .env (git-ignored) so the live pipeline works in local dev. On Vercel the same
// AI_API_KEY is configured in the project settings, so this is a no-op there.
function loadRootEnv() {
  const file = join(REPO_ROOT, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    const key = t.slice(0, i).trim()
    const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
}
loadRootEnv()

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `rvx` ships raw TypeScript (no build step); let Next transpile it.
  transpilePackages: ['rvx'],
  // The package symlink and the server-side reads of ../conformance, ../generated, ../prompts resolve
  // outside the app dir.
  experimental: { externalDir: true },
  // Vercel traces only files it sees imported; our server code reads sibling dirs via fs string paths,
  // so we must include them explicitly in the serverless bundle.
  outputFileTracingRoot: REPO_ROOT,
  outputFileTracingIncludes: {
    '/': ['../prompts/**', '../generated/spec/**', '../generated/impl/**'],
    '/api/generate': ['../generated/spec/**', '../prompts/**'],
    '/api/conformance': ['../conformance/**'],
  },
  // The Rust core (compiled to WebAssembly via wasm-pack, bundler target) is imported in the
  // sampler worker; webpack needs these experiments to instantiate it.
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true, topLevelAwait: true }
    // The sampler runs in an ES-module worker (modern targets), so async/await is available - tell
    // webpack, which otherwise warns when generating the async WASM instantiation code.
    config.output.environment = { ...config.output.environment, asyncFunction: true }
    return config
  },
}

export default nextConfig
