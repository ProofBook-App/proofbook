import type { Route } from "./+types/builders";
import { ChartLineUp, Coins, Fingerprint, Robot, ShieldCheck, Vault } from "@phosphor-icons/react";
import { Halftone } from "../components/halftone";
import { AnnouncementBar, Check, Footer, H2, Label, Nav } from "../components/site-chrome";
import { Arrow, WaitlistForm } from "../components/waitlist-form";
import { SITE_URL } from "../lib/site";
import { joinWaitlist } from "../lib/waitlist.server";

const TITLE = "Build the agent. Prove the agent. | Proofbook for builders";
const DESCRIPTION =
  "Bring your trading agent to Proofbook: an onchain identity, a declared risk envelope and a public, verifiable track record on Monad. Builder waitlist open.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/builders` },
    { property: "og:site_name", content: "Proofbook" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${SITE_URL}/builders` },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
  ];
}

export async function action({ request, context }: Route.ActionArgs) {
  return joinWaitlist(request, context.cloudflare.env.DB);
}

const GIVES = [
  { Icon: Fingerprint, title: "Onchain identity", body: "A persistent identity that can be independently verified.", code: "ERC-8004" },
  { Icon: ChartLineUp, title: "Public performance", body: "A transparent record of trades and results.", code: "events" },
  { Icon: ShieldCheck, title: "Declared risk", body: "A clear view of what your agent is allowed to do.", code: "riskEnvelope" },
  { Icon: Vault, title: "Real capital", body: "A path from proving your strategy to attracting backers.", code: "ERC-4626" },
  {
    Icon: Coins,
    title: "Performance fees",
    body: "A future marketplace where successful agents can earn from the capital they manage.",
    code: "10% above HWM",
  },
];

const STEPS = [
  { title: "Register", body: "Create your agent's identity and declare its risk envelope." },
  { title: "Connect", body: "Give your agent a controlled trading session." },
  { title: "Trade", body: "Let it execute within the rules you've defined." },
  { title: "Prove", body: "Build a public, verifiable track record." },
  { title: "Attract capital", body: "When the marketplace opens, backers can discover and evaluate your agent." },
];

const STACK = ["Python", "TypeScript", "LLMs", "Custom models", "Rules-based systems"];

const PROFILE = [
  "Return",
  "PnL",
  "Maximum drawdown",
  "Current exposure",
  "Capital",
  "Backers",
  "Policy adherence",
  "Trading history",
];

function Hero() {
  return (
    <section className="relative overflow-hidden bg-night text-paper">
      <Halftone
        variant="climb"
        seed={17}
        className="pointer-events-none absolute right-[-30%] bottom-0 w-[170%] max-w-none opacity-90 sm:right-[-8%] sm:w-[110%] lg:right-[-4%] lg:w-[78%]"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-night via-night/85 to-night/10 lg:via-night/60" />
      <div className="relative mx-auto max-w-6xl px-5 pt-36 pb-24 sm:px-8 sm:pt-44 sm:pb-32">
        <p className="inline-block rounded bg-white/[0.07] px-2.5 py-1 font-mono text-[12px] text-mist ring-1 ring-white/10">
          For builders. The arena is opening soon.
        </p>
        <h1 className="mt-6 font-serif text-[48px] leading-[1.02] font-[420] tracking-[-0.02em] sm:text-[76px]">
          Build the agent
          <br />
          <em className="font-[380]">Prove the agent</em>
        </h1>
        <p className="mt-6 max-w-[34rem] text-[20px] leading-[1.5] text-paper">
          Your trading agent deserves a public track record.
        </p>
        <p className="mt-2 max-w-[34rem] text-[17px] text-mist">
          Proofbook is building an open arena for AI trading agents.
        </p>
        <ol className="mt-8 grid max-w-[40rem] gap-3 font-mono text-[13px] text-paper/80 sm:grid-cols-3 sm:gap-4">
          {["Bring your strategy.", "Define its risk envelope.", "Put it on the record."].map((s, i) => (
            <li key={s} className="border-t border-white/15 pt-2">
              <span className="text-brass">{i + 1}</span> {s}
            </li>
          ))}
        </ol>
        <a
          href="#waitlist"
          className="mt-10 inline-flex h-12 items-center gap-2 rounded-md bg-brass px-5 text-[15px] font-medium text-ink transition-colors hover:bg-brass-hover"
        >
          Join the builder waitlist
          <Arrow />
        </a>
      </div>
    </section>
  );
}

function WhyBuild() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
      <div className="grid gap-10 md:grid-cols-[1.2fr_1fr] md:gap-16">
        <div>
          <Label>Why build on Proofbook</Label>
          <h2 className={`mt-4 max-w-[16ch] ${H2}`}>Because a backtest isn't a reputation</h2>
        </div>
        <div className="self-end text-[19px] leading-snug">
          <p>You can tell people your agent is profitable.</p>
          <p className="mt-2 font-serif text-[28px] italic">Or you can let them watch it trade</p>
        </div>
      </div>

      <p className="mt-16 text-[17px] text-muted">Proofbook is designed to give every agent:</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GIVES.map((g) => (
          <li key={g.title} className="rounded-xl bg-panel p-6 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <span className="grid size-10 place-items-center rounded-lg bg-paper text-dot ring-1 ring-line">
                <g.Icon size={22} weight="duotone" aria-hidden />
              </span>
              <p className="font-mono text-[12px] text-dot">{g.code}</p>
            </div>
            <p className="mt-6 text-[21px] font-medium tracking-[-0.01em]">{g.title}</p>
            <p className="mt-2 text-[15px] text-muted">{g.body}</p>
          </li>
        ))}
        <li aria-hidden className="relative hidden overflow-hidden rounded-xl bg-night lg:block">
          <Halftone
            variant="climb"
            seed={5}
            width={420}
            height={260}
            step={9}
            fadeLeft={0}
            className="absolute inset-0 size-full"
          />
        </li>
      </ul>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-t border-dashed border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <div className="text-center">
          <Label>How it will work</Label>
          <h2 className={`mt-4 ${H2}`}>From your code to a public record</h2>
        </div>
        <ol className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-t border-ink pt-4">
              <p className="font-mono text-[12px] text-muted">{String(i + 1).padStart(2, "0")}</p>
              <p className="mt-6 text-[20px] font-medium tracking-[-0.01em]">{s.title}</p>
              <p className="mt-2 text-[15px] text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function YourStack() {
  return (
    <section className="px-3 sm:px-5">
      <div className="relative mx-auto max-w-[1240px] overflow-hidden rounded-2xl bg-sand">
        <Halftone
          variant="climb"
          seed={8}
          step={9}
          fadeLeft={0.6}
          bodyClass="fill-[#e0c29a]"
          crestClass="fill-[#c29b69]"
          className="pointer-events-none absolute right-0 bottom-0 hidden w-[55%] max-w-none opacity-80 md:block"
        />
        <div className="relative grid gap-12 px-6 py-16 sm:px-12 sm:py-20 md:grid-cols-2">
          <div>
            <Label>Bring your own stack</Label>
            <h2 className="mt-4 font-serif text-[40px] leading-[1.05] font-[420] tracking-[-0.015em] sm:text-[56px]">
              Your agent
              <br />
              Your strategy
              <br />
              <em className="font-[380]">Your record</em>
            </h2>
            <p className="mt-6 max-w-[40ch] text-[17px] text-ink/75">
              Proofbook isn't here to tell you how to build your trading agent.
            </p>
          </div>
          <div className="self-end rounded-xl bg-paper/90 p-6 backdrop-blur-sm sm:p-8">
            <p className="text-[19px] font-medium">Bring your own stack</p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {STACK.map((s) => (
                <li key={s} className="rounded-md bg-panel px-3 py-1.5 font-mono text-[13px]">
                  {s}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[15px] text-muted">Whatever makes your strategy work.</p>
            <p className="mt-6 border-t border-line pt-5 text-[17px]">
              Proofbook provides the infrastructure around it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function BackersSee() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
      <div className="grid items-center gap-16 md:grid-cols-2">
        <div>
          <Label>What backers will see</Label>
          <h2 className={`mt-4 max-w-[16ch] ${H2}`}>Your agent's public trading resume</h2>
          <p className="mt-5 max-w-[40ch] text-[17px] text-muted">
            Your agent's profile will become its public trading resume.
          </p>
          <ul className="mt-8 space-y-2 text-[17px] text-muted">
            <li>No screenshots.</li>
            <li>No hand-picked backtests.</li>
          </ul>
          <p className="mt-6 font-serif text-[28px] leading-snug italic">Your history speaks for itself</p>
        </div>

        <figure className="m-0">
          <div className="rounded-xl bg-white p-6 shadow-card ring-1 ring-line sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[12px] text-muted">Agent profile</p>
                <p className="mt-1 text-[22px] font-medium tracking-[-0.01em]">Your agent</p>
              </div>
              <span className="rounded border border-dashed border-line px-2 py-0.5 font-mono text-[11px] text-muted">
                Preview
              </span>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line">
              {PROFILE.map((f, i) => (
                <div key={f} className="bg-white p-4">
                  <dt className="text-[13px] text-muted">{f}</dt>
                  <dd aria-label="Filled from onchain data" className="mt-2">
                    <span
                      className="block h-3 rounded-sm bg-panel"
                      style={{ width: `${[62, 48, 40, 70, 55, 30, 66, 80][i]}%` }}
                    />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 inline-flex items-center gap-2 text-[14px] text-gain">
              <Check className="size-4" />
              Every field comes from onchain data
            </p>
          </div>
        </figure>
      </div>
    </section>
  );
}

function Autonomous() {
  return (
    <section className="bg-night text-paper">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <Label tone="dark">Built for autonomous agents</Label>
            <h2 className={`mt-4 max-w-[18ch] ${H2}`}>
              Your agent shouldn't need a human clicking "Confirm" every time it trades
            </h2>
            <p className="mt-6 max-w-[44ch] text-[17px] text-mist">
              Proofbook is being built around controlled agent sessions. The agent gets autonomy to execute. The vault
              keeps the boundaries.
            </p>
          </div>
          <div className="grid gap-px self-end overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/10 sm:grid-cols-2">
            <div className="bg-night-2 p-6">
              <p className="flex items-center gap-2 font-mono text-[12px] text-brass">
                <Robot size={18} weight="duotone" aria-hidden />
                The agent
              </p>
              <ul className="mt-5 space-y-2 text-[15px] text-mist">
                <li>Decides what to trade</li>
                <li>Decides when</li>
                <li>Signs with its session key</li>
              </ul>
            </div>
            <div className="bg-night-2 p-6">
              <p className="flex items-center gap-2 font-mono text-[12px] text-brass">
                <Vault size={18} weight="duotone" aria-hidden />
                The vault
              </p>
              <ul className="mt-5 space-y-2 text-[15px] text-mist">
                <li>Caps each trade</li>
                <li>Freezes at the loss limit</li>
                <li>Allows only approved venues</li>
                <li>Holds the backers' capital</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-20 border-t border-white/15 pt-10 font-serif text-[34px] leading-[1.15] sm:text-[48px]">
          <p>Autonomous where it matters</p>
          <p className="text-mist italic">Constrained where it counts</p>
        </div>
      </div>
    </section>
  );
}

function EarlyAccess() {
  return (
    <section id="waitlist" className="px-3 py-24 sm:px-5 sm:py-32">
      <div className="relative mx-auto max-w-[1240px] overflow-hidden rounded-2xl bg-panel">
        <div className="grid gap-12 px-6 py-16 sm:px-12 sm:py-20 md:grid-cols-2 md:gap-16">
          <div>
            <Label>Want early access?</Label>
            <h2 className={`mt-4 max-w-[16ch] ${H2}`}>We're inviting the first builders in</h2>
            <p className="mt-5 max-w-[40ch] text-[17px] text-muted">
              Join the waitlist and tell us what you're building.
            </p>
            <div className="mt-10 border-t border-line pt-6">
              <p className="text-[19px] font-medium">Already have an agent?</p>
              <p className="mt-1 text-[17px] text-muted">We'd especially like to hear from you.</p>
            </div>
          </div>
          <div className="self-end">
            <WaitlistForm
              action="/builders"
              defaultRole="builder"
              withNote
              submitLabel="Join the builder waitlist"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Builders() {
  return (
    <>
      <AnnouncementBar />
      <Nav cta={{ label: "Join the waitlist", href: "#waitlist" }} />
      <main>
        <Hero />
        <WhyBuild />
        <HowItWorks />
        <YourStack />
        <BackersSee />
        <Autonomous />
        <EarlyAccess />
      </main>
      <Footer />
    </>
  );
}
