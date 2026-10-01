import type { ReactNode } from "react";

// The portfolio's dark header. The server renders it with a loading line; the client fills it in.
export function PortfolioHero({ children }: { children?: ReactNode }) {
  return (
    <section className="bg-night text-paper">
      <div className="mx-auto max-w-6xl px-5 pt-36 pb-12 sm:px-8 sm:pt-44 sm:pb-14">
        <p className="font-mono text-[12px] text-mist">
          <span className="text-brass">[</span> Portfolio <span className="text-brass">]</span>
        </p>
        <h1 className="mt-5 font-serif text-[44px] leading-[1.02] font-[420] tracking-[-0.02em] sm:text-[64px]">Your portfolio</h1>
        {children ?? <p className="mt-4 text-[15px] text-mist">Loading your account…</p>}
      </div>
    </section>
  );
}
