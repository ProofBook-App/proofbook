import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { Reveal } from "./components/reveal";
import { REPO_URL, SITE_URL } from "./lib/site";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

// Chrome and Android fire beforeinstallprompt once, often before hydration. Keep it for the
// "Install app" button (components/install-app.client.tsx) and tell the button it arrived.
const captureInstall = `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__pbInstall=e;dispatchEvent(new Event("pb:install"))})`;

// TODO: add the X account and the hackathon submission to sameAs once they exist.
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Proofbook",
    url: SITE_URL,
    sameAs: [REPO_URL],
  },
  { "@context": "https://schema.org", "@type": "WebSite", name: "Proofbook", url: SITE_URL },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Night, to match the manifest and the strip behind the iOS status bar (app.css). */}
        <meta name="theme-color" content="#141a26" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Proofbook" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <Meta />
        <Links />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script dangerouslySetInnerHTML={{ __html: captureInstall }} />
      </head>
      <body>
        {children}
        <Reveal />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // The service worker caches static files only (public/sw.js). Dev skips it so Vite's modules
  // are never served stale.
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something broke";
  let details = "The page failed to load. Reload to try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Page not found" : `Error ${error.status}`;
    details =
      error.status === 404
        ? "There is no page at this address. Check the link, or go to the home page."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-24">
      <h1 className="font-serif text-[56px] leading-[1.02] font-[420] tracking-[-0.02em]">{message}</h1>
      <p className="mt-4 max-w-[60ch] text-muted">{details}</p>
      <a
        href="/"
        className="mt-8 inline-flex min-h-12 items-center rounded-md bg-night px-5 font-medium text-paper transition-colors hover:bg-night-2"
      >
        Go to the home page
      </a>
      {stack && (
        <pre className="mt-8 overflow-x-auto rounded-lg bg-panel p-4 font-mono text-[13px]">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
