import { useId } from "react";
import { useFetcher } from "react-router";

export type WaitlistResult = { ok: true; email: string; role: Role } | { ok: false; error: string };
export type Role = "backer" | "builder";

export function WaitlistForm({
  withRole = false,
  defaultRole = "backer",
  submitLabel = "Join the waitlist",
  tone = "light",
  action = "/?index",
  withNote = false,
}: {
  withRole?: boolean;
  defaultRole?: Role;
  submitLabel?: string;
  tone?: "light" | "dark";
  action?: string;
  withNote?: boolean;
}) {
  const fetcher = useFetcher<WaitlistResult>();
  const id = useId();
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const dark = tone === "dark";

  if (result?.ok) {
    return (
      <p role="status" className={`max-w-[46ch] text-[16px] ${dark ? "text-mist" : "text-muted"}`}>
        <span className={`font-serif text-[24px] leading-tight ${dark ? "text-paper" : "text-ink"}`}>
          You're on the list.
        </span>{" "}
        We have you down as a {result.role}. We'll email{" "}
        <span className={dark ? "text-paper" : "text-ink"}>{result.email}</span> when{" "}
        {result.role === "builder" ? "agents can enter" : "the first vaults open"}.
      </p>
    );
  }

  return (
    <fetcher.Form method="post" action={action} className="w-full max-w-[30rem]" noValidate>
      {withRole && (
        <fieldset className="mb-3">
          <legend className="sr-only">I want to</legend>
          <div className={`inline-flex rounded-lg p-1 ${dark ? "bg-white/[0.08] ring-1 ring-white/10" : "bg-panel-2/70"}`}>
            {(
              [
                ["backer", "Back agents"],
                ["builder", "Enter an agent"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-md px-4 py-2 text-[14px] transition-colors has-checked:bg-paper ${dark ? "text-mist" : "text-muted"} has-checked:text-ink has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-dot`}
              >
                <input
                  type="radio"
                  name="role"
                  value={value}
                  defaultChecked={value === defaultRole}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!withRole && <input type="hidden" name="role" value={defaultRole} />}

      {/* Honeypot: people never see or fill this. */}
      <div aria-hidden className="absolute -left-[9999px]">
        <label>
          Company <input type="text" name="company" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {withNote && (
        <div className="mb-3">
          <label htmlFor={`${id}-note`} className={`mb-1.5 block text-[14px] ${dark ? "text-mist" : "text-muted"}`}>
            What are you building? <span className="opacity-70">(optional)</span>
          </label>
          <textarea
            id={`${id}-note`}
            name="note"
            rows={3}
            maxLength={1000}
            placeholder="A mean-reversion agent on MON perps, written in Python"
            className={`w-full resize-y rounded-md border px-4 py-3 text-[16px] transition-colors focus:outline-none ${
              dark
                ? "border-white/15 bg-white/[0.06] text-paper placeholder:text-mist/60 focus:border-mist"
                : "border-line bg-white text-ink placeholder:text-muted/60 focus:border-ink"
            }`}
          />
        </div>
      )}

      <label htmlFor={`${id}-email`} className="sr-only">
        Email address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          aria-invalid={result && !result.ok ? true : undefined}
          aria-describedby={result && !result.ok ? `${id}-error` : undefined}
          className={`min-h-12 w-full rounded-md border px-4 text-[16px] transition-colors focus:outline-none ${
            dark
              ? "border-white/15 bg-white/[0.06] text-paper placeholder:text-mist/70 focus:border-mist"
              : "border-line bg-white text-ink placeholder:text-muted/70 focus:border-ink"
          }`}
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-brass px-5 text-[15px] font-medium whitespace-nowrap text-ink transition-colors hover:bg-brass-hover active:translate-y-px disabled:cursor-progress disabled:opacity-70"
        >
          {busy ? "Joining…" : submitLabel}
          <Arrow />
        </button>
      </div>
      {result && !result.ok && (
        <p id={`${id}-error`} role="alert" className={`mt-2 text-[14px] ${dark ? "text-sand" : "text-limit"}`}>
          {result.error}
        </p>
      )}
    </fetcher.Form>
  );
}

export function Arrow({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
