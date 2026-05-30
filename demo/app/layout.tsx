// Core
import type { Metadata } from 'next'
// Styles
import './globals.css'

export const metadata: Metadata = {
  title: 'RV Exchange - cross-language demo',
  description:
    'Build a random variable, sample it live, and see the same .rv.json evaluated identically by the Python, TypeScript, and Rust reference implementations.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
