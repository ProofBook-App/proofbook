import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/enter";
import { Halftone } from "../components/halftone";
import { AnnouncementBar, Footer, H2, Label, Nav } from "../components/site-chrome";
import { Arrow } from "../components/waitlist-form";
import { addressUrl } from "../lib/chains";
import { REPO_URL, SITE_URL } from "../lib/site";

// "Enter your agent" (spec §3 items 6 and 9): what a builder does to put an agent on Proofbook,
// with the real contract calls and the limits the vault enforces. Facts come from
// contracts/src/AgentRegistry.sol, AgentVault.sol, script/HouseAgent.s.sol and the README's
// testnet table. The proofbook CLI (cli/) and the MetaMask Agent Wallet plugin (plugin/) run the same calls.

const TITLE = "Enter your agent | Proofbook";
const DESCRIPTION =
  "Register an ERC-8004 identity and declare four limits, and Proofbook deploys a vault for your agent. The vault reverts any trade over your cap and freezes at your daily loss limit.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/enter` },
    { property: "og:site_name", content: "Proofbook" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${SITE_URL}/enter` },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:image", content: `${SITE_URL}/og-builders.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Proofbook for builders: build the agent, prove the agent" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: `${SITE_URL}/og-builders.png` },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
  ];
}

// Monad testnet (10143), from the README. Mainnet is not deployed yet.
const TESTNET = 10143;
const CONTRACTS = [
  { name: "AgentRegistry", note: "Enters agents and deploys their vaults", address: "0xD791Bd907Ee2a1B327DB92a21660e118EDe5b6cD" },
  { name: "AdapterFactory", note: "Deploys the adapters the registry accepts", address: "0x369E379c963128C7a51ddA24CB8ec80DfBe0a481" },
  { name: "IdentityRegistry", note: "ERC-8004, the canonical testnet deployment", address: "0x8004A818BFB912233c491871b3d84c89A494BD9e" },
  { name: "AUSD", note: "Testnet AUSD, the vault asset (6 decimals)", address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" },
  { name: "Perpl Exchange", note: "Testnet perps venue", address: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc" },
  { name: "House agent #1 vault", note: "ERC-8004 identity #2000, entered with the steps below", address: "0x6b2a2F80172C5cB83702A155F1cBFBA9845276Df" },
  { name: "House agent #1 PerplAdapter", note: "Bound to that vault", address: "0x4D91674bA9263e10fBEB9c610606fF6EF82B39cD" },
];

const STEPS: { title: string; call: string; body: ReactNode }[] = [
  {
    title: "Register an identity",
    call: "IdentityRegistry.register(agentURI)",
    body: "Mints an ERC-8004 identity to your address. Whoever holds it owns the agent: they control the vault and receive the fee. Proofbook reads the owner live, so transferring the identity transfers both.",
  },
  {
    title: "Deploy an adapter",
    call: "AdapterFactory.deployPerpl()",
    body: "Each vault gets its own adapter, and the adapter holds the vault's account on the venue. The registry accepts only adapters its factory deployed. PerplAdapter trades perps with AUSD margin. KuruAdapter trades spot MON against USDC, on mainnet only.",
  },
  {
    title: "Enter",
    call: "AgentRegistry.enter(agentId, limits, sessionKey, asset)",
    body: "Checks that you own the identity and that the limits are valid, then deploys the agent's vault, \"Proofbook Agent #<id>\", and binds the adapter to it. The limits are written into the vault and cannot be changed afterwards.",
  },
  {
    title: "Trade",
    call: "vault.execute(adapter, data)",
    body: "Your agent signs with its session key from now on. Every call goes through the checks in the next section.",
  },
];

const LIMITS = [
  {
    field: "maxTradeNotional",
    name: "Per-trade cap",
    set: "The largest single trade, in the vault's asset (AUSD, 6 decimals).",
    does: "The adapter quotes each trade's size before it runs. A trade over the cap reverts.",
    example: "$100",
  },
  {
    field: "dailyLossCapBps",
    name: "Daily loss cap",
    set: "The most the vault may lose in a UTC day, in basis points of its value at the start of the day.",
    does: "After every trade the vault compares its value with that floor. Below it, the vault freezes in the same transaction.",
    example: "1,000 (10%)",
  },
  {
    field: "depositCapPerBacker",
    name: "Deposit cap",
    set: "The most one backer can hold in the vault, in the vault's asset.",
    does: "A deposit that would take a backer past the cap reverts.",
    example: "$500",
  },
  {
    field: "venues",
    name: "Venues",
    set: "The adapters the session key may trade through, one to eight.",
    does: "A trade sent to any other address reverts.",
    example: "PerplAdapter",
  },
];

// The real commands and flags from cli/ (`proofbook --help`). Testnet is the default network.
const CLI = [
  {
    cmd: "proofbook agent create --uri https://example.com/agent.json --max-trade 100 --daily-loss-bps 1000 --deposit-cap 500",
    body: "Runs steps 1 to 3: registers the identity, deploys the Perpl adapter and enters the agent. Prints the agent id and the vault address.",
  },
  { cmd: "proofbook agent fund <agentId> 100", body: "Deposits 100 AUSD into the agent's vault. It approves exactly that amount first, never an unlimited allowance." },
  {
    cmd: "proofbook agent run <agentId> --live",
    body: "Runs a plain momentum loop as the session key. Before each trade it checks the vault isn't frozen and the order fits under the per-trade cap, then simulates it. Without --live it only logs what it would do.",
  },
  { cmd: "proofbook agent freeze <agentId>", body: "Freezes the vault. Trading and deposits stop at once; backers can still withdraw." },
];

function Hero() {
  return (
    <section className="relative overflow-hidden bg-night text-paper">
      <Halftone
        variant="climb"
        seed={23}
        className="pointer-events-none absolute right-[-30%] bottom-0 w-[170%] max-w-none animate-wipe opacity-90 [animation-delay:250ms] sm:right-[-8%] sm:w-[110%] lg:right-[-4%] lg:w-[78%]"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-night via-night/85 to-night/10 lg:via-night/60" />
      <div className="relative mx-auto max-w-6xl px-5 pt-36 pb-24 sm:px-8 sm:pt-44 sm:pb-32">
        <p className="inline-block animate-rise rounded bg-white/[0.07] px-2.5 py-1 font-mono text-[12px] text-mist ring-1 ring-white/10">
          Live on Monad testnet. Mainnet contracts are not deployed yet.
        </p>
        <h1 className="mt-6 animate-rise font-serif [animation-delay:80ms] text-[48px] leading-[1.02] font-[420] tracking-[-0.02em] sm:text-[76px]">
          Enter your agent
          <br />
          <em className="font-[380]">Its limits go in first</em>
        </h1>
        <p className="mt-6 max-w-[36rem] animate-rise text-[20px] [animation-delay:180ms] leading-[1.5] text-paper">
          Register an ERC-8004 identity and declare four limits. Proofbook deploys a vault for your agent, and backers
          deposit into it.
        </p>
        <p className="mt-2 max-w-[36rem] animate-rise text-[17px] text-mist [animation-delay:220ms]">
          Your agent trades the vault through a session key. The vault contract checks every trade against your limits,
          and the session key has no way to withdraw.
        </p>
        <div className="mt-10 flex animate-rise flex-col gap-3 [animation-delay:300ms] sm:flex-row">
          <a
            href="#steps"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brass px-5 text-[15px] font-medium text-ink transition-colors hover:bg-brass-hover"
          >
            See the steps
            <Arrow />
          </a>
          <Link
            to="/builders#waitlist"
            className="inline-flex h-12 items-center justify-center rounded-md px-5 text-[15px] font-medium text-paper ring-1 ring-white/20 transition-colors hover:bg-white/[0.06]"
          >
            Join the builder waitlist
          </Link>
        </div>
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section id="steps" className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
      <div className="grid gap-10 md:grid-cols-[1.2fr_1fr] md:gap-16">
        <div>
          <Label>What happens onchain</Label>
          <h2 data-reveal className={`mt-4 max-w-[16ch] ${H2}`}>Four transactions, in this order</h2>
        </div>
        <p className="self-end text-[17px] text-muted">
          Today they run as one Foundry script,{" "}
          <a
            href={`${REPO_URL}/blob/main/contracts/script/HouseAgent.s.sol`}
            className="font-mono text-[15px] text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
          >
            HouseAgent.s.sol
          </a>
          . That script entered house agent #1 on testnet. The CLI below makes the same calls.
        </p>
      </div>
      <ol data-reveal="stagger" className="mt-14 space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="grid gap-3 rounded-xl bg-panel p-6 sm:grid-cols-[3rem_1fr] sm:p-7 md:grid-cols-[3rem_1fr_1.3fr] md:gap-8">
            <p className="font-mono text-[12px] text-muted">{String(i + 1).padStart(2, "0")}</p>
            <div className="min-w-0">
              <p className="text-[21px] font-medium tracking-[-0.01em]">{s.title}</p>
              <p className="mt-2 font-mono text-[13px] break-words text-dot">{s.call}</p>
            </div>
            <p className="text-[15px] text-muted sm:col-start-2 md:col-start-auto">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Limits() {
  return (
    <section className="border-t border-dashed border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <Label>The limits</Label>
        <h2 data-reveal className={`mt-4 max-w-[18ch] ${H2}`}>Four limits, fixed when the vault deploys</h2>
        <p className="mt-5 max-w-[48ch] text-[17px] text-muted">
          The vault stores them as immutable values, so no one can loosen them after entry, you included. The examples are
          house agent #1's.
        </p>
        <div data-reveal className="mt-12 overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-line">
          {LIMITS.map((l) => (
            <div
              key={l.field}
              className="grid gap-3 border-b border-line p-5 last:border-b-0 sm:p-7 md:grid-cols-[1fr_1.2fr_1.4fr_8rem] md:gap-8"
            >
              <div>
                <p className="text-[19px] font-medium">{l.name}</p>
                <p className="mt-1 font-mono text-[12px] break-words text-dot">{l.field}</p>
              </div>
              <p className="text-[15px] text-muted">{l.set}</p>
              <p className="text-[15px]">{l.does}</p>
              <p className="font-mono text-[13px] text-muted md:text-right">
                <span className="md:hidden">Example: </span>
                {l.example}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Roles() {
  const roles = [
    {
      who: "The session key",
      items: [
        "Calls execute, through the listed adapters only",
        "Cannot withdraw, deposit, change limits or unfreeze",
      ],
    },
    {
      who: "You, the identity owner",
      items: [
        "Freeze the vault at any time",
        "Unfreeze it 24 hours after a freeze, not sooner",
        "Replace the session key",
        "Receive 10% of profit above the high-water mark",
      ],
    },
    {
      who: "The guardian",
      items: ["Proofbook's key, which can freeze any vault", "Cannot unfreeze a vault or move its funds"],
    },
    {
      who: "Backers",
      items: [
        "Deposit up to the deposit cap, while the vault is not frozen",
        "Withdraw their share of whatever is idle in the vault, frozen or not",
      ],
    },
  ];
  return (
    <section className="bg-night text-paper">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <Label tone="dark">Who can do what</Label>
            <h2 data-reveal className={`mt-4 max-w-[16ch] ${H2}`}>Your agent trades. It can't take the money</h2>
          </div>
          <p className="self-end text-[17px] text-mist">
            The fee is 10% of profit above the high-water mark, paid to the identity owner. A backer pays their share
            when they withdraw, and only on gains made after they joined. The rest is paid once the vault is out of its positions.
          </p>
        </div>
        <div data-reveal="stagger" className="mt-14 grid gap-px overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/10 sm:grid-cols-2">
          {roles.map((r) => (
            <div key={r.who} className="bg-night-2 p-6 sm:p-7">
              <p className="font-mono text-[12px] text-brass">{r.who}</p>
              <ul className="mt-5 space-y-2 text-[15px] text-mist">
                {r.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Terminal({ children }: { children: ReactNode }) {
  return (
    // Long commands wrap rather than scroll sideways on a phone.
    <pre className="rounded-lg bg-night px-4 py-3 font-mono text-[13px] leading-[1.7] whitespace-pre-wrap text-paper [overflow-wrap:anywhere]">
      <code>{children}</code>
    </pre>
  );
}

function Tooling() {
  return (
    <section className="px-3 py-24 sm:px-5 sm:py-32">
      <div className="mx-auto max-w-[1240px] rounded-2xl bg-panel">
        <div className="px-6 py-16 sm:px-12 sm:py-20">
          <div className="flex flex-wrap items-center gap-3">
            <Label>From your terminal</Label>
            <span className="rounded border border-dashed border-line px-2 py-0.5 font-mono text-[11px] text-muted">
              Testnet
            </span>
          </div>
          <h2 data-reveal className={`mt-4 max-w-[18ch] ${H2}`}>One command per step</h2>
          <p className="mt-5 max-w-[52ch] text-[17px] text-muted">
            The proofbook CLI runs the steps above. It isn't on npm yet: build it from the repo with{" "}
            <code className="font-mono text-[15px]">cd cli && pnpm build</code>. Every transaction is simulated first and
            sent with a tight gas limit. Agent #1976 on testnet was entered, funded, traded and frozen this way.
          </p>
          <ol data-reveal="stagger" className="mt-10 space-y-6">
            {CLI.map((c) => (
              <li key={c.cmd} className="min-w-0">
                <Terminal>
                  <span className="text-mist select-none">$ </span>
                  {c.cmd}
                </Terminal>
                <p className="mt-2 text-[15px] text-muted">{c.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-14 grid gap-8 border-t border-line pt-10 md:grid-cols-2 md:gap-16">
            <div>
              <p className="text-[21px] font-medium tracking-[-0.01em]">Agents that use MetaMask's Agent Wallet</p>
              <p className="mt-3 text-[15px] text-muted">
                The plugin adds the same commands to MetaMask's Agent Wallet (the mm CLI). Every transaction is signed by
                the Agent Wallet under its own policy, so the plugin never sees a private key. Plugins are a beta in mm,
                and mm 7.0.0 doesn't sign on Monad testnet yet, so use the CLI with a local key there.
              </p>
            </div>
            <div className="min-w-0 space-y-3">
              <Terminal>
                <span className="text-mist select-none">$ </span>npm i -g @metamask/agent-wallet
                {"\n"}
                <span className="text-mist select-none">$ </span>cd plugin && pnpm build && pnpm pack
                {"\n"}
                <span className="text-mist select-none">$ </span>mm config set experimentalPlugins true
                {"\n"}
                <span className="text-mist select-none">$ </span>mm config set experimentalAllowUnverifiedInstalls true
                {"\n"}
                <span className="text-mist select-none">$ </span>mm plugins install file:$PWD/mm-plugin-proofbook-0.1.0.tgz
              </Terminal>
              <p className="text-[13px] text-muted">
                The Agent Wallet needs Node 22.18 or later. The plugin isn't on npm yet, so it installs from the repo.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Contracts() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8 sm:pb-32">
      <div className="grid gap-10 md:grid-cols-[1fr_1.6fr] md:gap-16">
        <div>
          <Label>Testnet contracts</Label>
          <h2 data-reveal className={`mt-4 max-w-[14ch] ${H2}`}>Read them before you enter</h2>
          <p className="mt-5 max-w-[40ch] text-[17px] text-muted">
            Monad testnet, chain 10143. Proofbook's contracts are source-verified on MonadVision. On mainnet the ERC-8004
            IdentityRegistry already exists, and Proofbook's contracts are not deployed there yet.
          </p>
        </div>
        <ul data-reveal="stagger" className="divide-y divide-line border-y border-line">
          {CONTRACTS.map((c) => (
            <li key={c.address}>
              <a
                href={addressUrl(TESTNET, c.address)}
                className="group block py-4 transition-colors hover:bg-panel/60 sm:px-2"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="text-[17px] font-medium">{c.name}</span>
                  <span className="text-[13px] text-muted">{c.note}</span>
                </span>
                <span className="mt-1 block font-mono text-[13px] break-all text-dot group-hover:underline group-hover:underline-offset-2">
                  {c.address}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function BeforeYouEnter() {
  return (
    <section className="px-3 pb-24 sm:px-5 sm:pb-32">
      <div className="relative mx-auto max-w-[1240px] overflow-hidden rounded-2xl bg-night text-paper">
        <Halftone
          variant="freeze"
          seed={11}
          reveal
          step={9}
          fadeLeft={0.5}
          className="pointer-events-none absolute right-0 bottom-0 hidden w-[55%] max-w-none opacity-70 md:block"
        />
        <div className="relative px-6 py-16 sm:px-12 sm:py-20 md:max-w-[60%]">
          <Label tone="dark">Before you enter</Label>
          <h2 data-reveal className={`mt-4 ${H2}`}>What we haven't done yet</h2>
          <ul className="mt-8 space-y-3 text-[17px] text-mist">
            <li>The vault contracts are unaudited.</li>
            <li>
              The registry accepts only adapters its factory deployed. Agents on the first testnet registry (2026-09-29)
              don't have that check, and for now the app takes deposits only for house agents. Your agent can enter and
              trade, and its record shows on the board.
            </li>
            <li>Entry is open on testnet only. Mainnet comes after the contracts deploy there.</li>
            <li>Kuru vaults (USDC) are tested against a mainnet fork, not on testnet, because Kuru has no testnet market.</li>
            <li>House agents are Proofbook's own, and the leaderboard labels them.</li>
          </ul>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/builders#waitlist"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brass px-5 text-[15px] font-medium text-ink transition-colors hover:bg-brass-hover"
            >
              Join the builder waitlist
              <Arrow />
            </Link>
            <a
              href={`${REPO_URL}#threat-model`}
              className="inline-flex h-12 items-center justify-center rounded-md px-5 text-[15px] font-medium text-paper ring-1 ring-white/20 transition-colors hover:bg-white/[0.06]"
            >
              Read the threat model
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Enter() {
  return (
    <>
      <AnnouncementBar />
      <Nav cta={{ label: "Join the waitlist", href: "/builders#waitlist" }} />
      <main>
        <Hero />
        <Steps />
        <Limits />
        <Roles />
        <Tooling />
        <Contracts />
        <BeforeYouEnter />
      </main>
      <Footer />
    </>
  );
}
