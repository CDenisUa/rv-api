/** @type {import('next').NextConfig} */
const nextConfig = {
  // `rvx` ships raw TypeScript (no build step); let Next transpile it.
  transpilePackages: ['rvx'],
  // The package symlink and the server-side read of ../conformance resolve outside the app dir.
  experimental: { externalDir: true },
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
