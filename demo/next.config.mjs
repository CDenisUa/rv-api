/** @type {import('next').NextConfig} */
const nextConfig = {
  // `rvx` ships raw TypeScript (no build step); let Next transpile it.
  transpilePackages: ['rvx'],
  // The package symlink and the server-side read of ../conformance resolve outside the app dir.
  experimental: { externalDir: true },
}

export default nextConfig
