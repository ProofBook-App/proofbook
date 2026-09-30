import type { ReactNode } from "react";
import { Mark } from "./halftone";
import { Arrow } from "./waitlist-form";
import { REPO_URL } from "../lib/site";

// Section headline size, shared by every page.
export const H2 = "font-serif text-[38px] leading-[1.08] font-[420] tracking-[-0.015em] text-balance sm:text-[52px]";

export function Label({ children, tone = "light" }: { children: ReactNode; tone?: "light" | "dark" }) {
  const bracket = tone === "dark" ? "text-brass" : "text-dot";
  return (
    <p className={`font-mono text-[12px] tracking-tight ${tone === "dark" ? "text-mist" : "text-muted"}`}>
      <span className={bracket}>[</span> {children} <span className={bracket}>]</span>
    </p>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark className="size-[18px]" />
      <span className="font-serif text-[21px] leading-none tracking-[-0.01em]">Proofbook</span>
    </span>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AnnouncementBar() {
  return (
    <div className="bg-sand px-4 py-2 text-center text-[13px]">
      Proofbook vaults are running on Monad testnet. The mainnet waitlist is open.{" "}
      <a href={`${REPO_URL}#testnet-deployments-10143`} className="underline underline-offset-2">
        See the contracts
      </a>
    </div>
  );
}

export function Nav({ cta = { label: "Join the waitlist", href: "#join" } }: { cta?: { label: string; href: string } }) {
  return (
    <header className="sticky top-3 z-50 mt-3 -mb-[68px] px-3">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-5xl items-center justify-between rounded-xl bg-night/85 pr-2 pl-4 text-paper shadow-card ring-1 ring-white/10 backdrop-blur-md"
      >
        <a href="/" aria-label="Proofbook home" className="rounded-sm">
          <Wordmark />
        </a>
        <div className="flex items-center gap-1">
          <a href="/leaderboard" className="hidden px-3 py-2 text-[14px] text-mist transition-colors hover:text-paper sm:block">
            Leaderboard
          </a>
          <a href="/builders" className="hidden px-3 py-2 text-[14px] text-mist transition-colors hover:text-paper sm:block">
            Builders
          </a>
          <a href={REPO_URL} className="hidden px-3 py-2 text-[14px] text-mist transition-colors hover:text-paper sm:block">
            GitHub
          </a>
          <a
            href={cta.href}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brass px-4 text-[14px] font-medium text-ink transition-colors hover:bg-brass-hover"
          >
            {cta.label}
            <Arrow />
          </a>
        </div>
      </nav>
    </header>
  );
}

export function Footer({ notes }: { notes?: { n: number; text: string; href: string }[] }) {
  const cols: { head: string; links: { label: string; href?: string }[] }[] = [
    {
      head: "Product",
      links: [
        { label: "Agents" },
        { label: "Leaderboard", href: "/leaderboard" },
        { label: "Builders", href: "/builders" },
        { label: "Waitlist", href: "/#join" },
      ],
    },
    {
      head: "Code",
      links: [
        { label: "GitHub", href: REPO_URL },
        { label: "Contracts", href: `${REPO_URL}/tree/main/contracts/src` },
        { label: "Threat model", href: `${REPO_URL}#threat-model` },
      ],
    },
  ];
  return (
    <footer className="border-t border-dashed border-line">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-4 text-[15px]">AI trading agents. Proven in public.</p>
            <p className="mt-1 text-[15px] text-muted">Built on Monad.</p>
          </div>
          {cols.map((c) => (
            <div key={c.head}>
              <p className="text-[14px] font-medium">{c.head}</p>
              <ul className="mt-4 space-y-2 text-[14px] text-muted">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.href ? (
                      <a href={l.href} className="transition-colors hover:text-ink">
                        {l.label}
                      </a>
                    ) : (
                      <span>
                        {l.label} <span className="font-mono text-[11px]">(soon)</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {notes && (
          <ol className="mt-16 space-y-1 text-[12px] text-muted">
            {notes.map((f) => (
              <li key={f.n} id={`note-${f.n}`}>
                <sup>{f.n}</sup>{" "}
                <a href={f.href} className="underline decoration-line underline-offset-2 hover:text-ink">
                  {f.text}
                </a>
              </li>
            ))}
          </ol>
        )}
        <p className={`${notes ? "mt-6" : "mt-16"} max-w-[80ch] text-[12px] text-muted`}>
          Proofbook is a hackathon prototype. The vault contracts are unaudited. Trading involves risk. Past performance
          does not guarantee future results.
        </p>
        <p className="mt-6 text-[12px] text-muted">© 2026 Proofbook</p>
      </div>
    </footer>
  );
}
