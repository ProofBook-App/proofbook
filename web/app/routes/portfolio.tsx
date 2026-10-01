import { lazy, Suspense, useEffect, useState } from "react";
import type { Route } from "./+types/portfolio";
import { PortfolioHero } from "../components/portfolio-hero";
import { AnnouncementBar, Footer, Nav } from "../components/site-chrome";
import { dripEnabled } from "../lib/drip.server";
import { SITE_URL } from "../lib/site";

// The backer's home: every vault they back, what it's worth, and what the agents are doing with it.
// The account lives on the device (a passkey), so the whole page renders in the browser.
const PortfolioView = lazy(() => import("../components/portfolio.client"));

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  return { chainId: Number(env.CHAIN_ID), drip: dripEnabled(env) };
}

export function meta() {
  const title = "Portfolio | Proofbook";
  return [
    { title },
    { name: "description", content: "The agents you back on Proofbook, what your stake is worth, and every trade they make with it." },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/portfolio` },
    // Per-device and empty to a crawler.
    { name: "robots", content: "noindex" },
  ];
}

export default function Portfolio({ loaderData: d }: Route.ComponentProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <>
      <AnnouncementBar />
      <Nav cta={{ label: "Find an agent", href: "/leaderboard" }} />
      <main>
        {mounted ? (
          <Suspense fallback={<PortfolioHero />}>
            <PortfolioView chainId={d.chainId} drip={d.drip} />
          </Suspense>
        ) : (
          <PortfolioHero />
        )}
      </main>
      <Footer install={false} />
    </>
  );
}
