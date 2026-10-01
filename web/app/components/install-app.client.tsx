// "Install app": Chrome, Edge and Android hand us a beforeinstallprompt event, which the inline
// script in root.tsx catches before hydration (it can fire before this module loads). iOS Safari
// has no such event, so iPhones and iPads get a one-time hint to add Proofbook from the Share
// sheet. Nothing shows once Proofbook runs as an installed app.

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
declare global {
  interface Window {
    __pbInstall?: InstallEvent;
  }
}

const HINT_KEY = "proofbook:ios-install-hint";

function standalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Safari on iPhone and iPad (iPadOS reports itself as a Mac with a touch screen).
function iosSafari() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function hintDismissed() {
  try {
    return localStorage.getItem(HINT_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export default function InstallApp({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [hint, setHint] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (standalone()) {
      setInstalled(true);
      return;
    }
    const pick = () => setPrompt(window.__pbInstall ?? null);
    const done = () => {
      window.__pbInstall = undefined;
      setInstalled(true);
    };
    pick();
    setHint(iosSafari() && !hintDismissed());
    window.addEventListener("pb:install", pick);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("pb:install", pick);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  if (installed) return null;

  const dark = tone === "dark";
  const button = dark
    ? "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-[14px] font-medium text-paper ring-1 ring-white/20 transition-colors hover:bg-white/[0.06]"
    : "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-[14px] font-medium text-ink ring-1 ring-line transition-colors hover:bg-panel";

  if (prompt) {
    const install = async () => {
      await prompt.prompt();
      await prompt.userChoice;
      // The event can only be used once, accepted or not.
      window.__pbInstall = undefined;
      setPrompt(null);
    };
    return (
      <button type="button" className={button} onClick={install}>
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Install app
      </button>
    );
  }

  if (hint) {
    const dismiss = () => {
      try {
        localStorage.setItem(HINT_KEY, "dismissed");
      } catch {
        // Private mode: it shows again next visit, which is harmless.
      }
      setHint(false);
    };
    return (
      <div
        className={`flex max-w-[26rem] items-center gap-3 rounded-lg py-1 pr-1 pl-3 text-[14px] ring-1 ${dark ? "bg-white/[0.06] text-mist ring-white/10" : "bg-panel text-muted ring-line"}`}
      >
        <p className="py-2">
          Install Proofbook on this {/iPad/.test(navigator.userAgent) ? "iPad" : "iPhone"}: tap Share, then Add to Home
          Screen.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className={`min-h-11 shrink-0 rounded-md px-3 font-medium ${dark ? "text-paper hover:bg-white/[0.06]" : "text-ink hover:bg-panel-2"}`}
        >
          Got it
        </button>
      </div>
    );
  }

  return null;
}
