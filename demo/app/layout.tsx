// Core
import type { Metadata, Viewport } from 'next'
// Styles
import './globals.css'

export const metadata: Metadata = {
  title: 'RV Exchange - cross-language demo',
  description:
    'Build a random variable, sample it live, and see the same .rv.json evaluated identically by the Python, TypeScript, and Rust reference implementations.',
  icons: {
    icon: '/images/brand/mcl-logo.jpg',
  },
}

// Explicit mobile viewport so phones/tablets render at device width (no zoomed-out desktop layout).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
