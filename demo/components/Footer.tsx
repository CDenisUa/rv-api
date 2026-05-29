// Site footer + the developer credit strip (Designed by Chepio), dark-theme variant.

export function Footer() {
  return (
    <footer className="mt-16 border-t border-white/5">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <p className="text-sm text-slate-500">
          RV Exchange Format v1 — a portable, language-neutral way to serialize a random variable. The
          spec, an executable conformance suite, and reference implementations in Python, TypeScript,
          and Rust (→ WebAssembly).
        </p>
      </div>

      {/* Developer credit strip */}
      <div className="bg-black/30 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-3 flex justify-end">
          <a
            href="https://chepio.tech"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-25 hover:opacity-100 transition-all duration-300"
            aria-label="Developed by Chepio"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/icons/logo_designed.svg"
              alt="chepio.tech"
              className="h-7 w-auto brightness-0 invert hover:brightness-100 hover:invert-0 transition-all duration-300"
            />
          </a>
        </div>
      </div>
    </footer>
  )
}
