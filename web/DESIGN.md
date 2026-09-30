# Proofbook web design

Inspired by agora.finance, at the user's request (2026-09-30): warm paper, a dark ink hero, a serif display over a plain sans, halftone imagery, bracketed mono labels. Copy comes from the user's landing page draft; facts follow `docs/brand/research.md` and `docs/brand/voice.md`.

## Colour (tokens in `app/app.css`)

| Token | Hex | Use |
|---|---|---|
| paper | #f8f7f4 | Page ground |
| panel / panel-2 | #efebe4 / #e6e0d5 | Cards and bands on paper |
| ink / muted | #1c1b18 / #625f58 | Text |
| line | #dcd6cb | Rules and borders |
| night / night-2 | #141a26 / #1d2535 | Hero, builders band, final CTA, nav |
| dot / mist | #3b4a68 / #aab6cc | Halftone dots, text on night |
| brass | #d8c27a | Primary buttons only |
| sand | #eed9b9 | Announcement bar, "Why now" band |
| limit | #b23a26 | Loss floor and limits only |
| gain | #2f6a47 | Positive figures and policy checks |
| limit-soft / gain-soft | #f0a08f / #8fd1a8 | The same, on night (agent profile hero) |

Light only, like the reference.

## Type

- Newsreader (serif, variable opsz): headlines, big figures. Weight 380–420, tight tracking. The second line of a two-line headline may be italic.
- Geist: body and UI.
- Geist Mono: bracketed section labels `[ Like this ]` in sentence case, contract identifiers (`maxTradeNotional`), step numbers.

## Signature: halftone charts

`app/components/halftone.tsx` draws price paths as dot grids, the way Agora prints its photos. `climb` is a rising path (hero, why-now, final CTA, agent preview sparkline). `freeze` falls to a red floor and goes flat (rules band), which is the vault's daily-loss freeze. Deterministic, SSR-safe, one `<path>` per layer. The logo `Mark` is the same idea at 16 px.

## Motion

- **Hero:** one load sequence. The copy rises in a short stagger (`animate-rise` plus `[animation-delay:…]`) and the halftone chart draws in from left to right (`animate-wipe`).
- **Below the fold:** each block eases in once as it enters the viewport.
  - `data-reveal` fades and rises the element.
  - `data-reveal="stagger"` does the same to a list's children in turn.
  - Halftones take `<Halftone reveal />` and draw in from left to right.
  - `app/components/reveal.tsx` sets `data-in`. The hidden state only applies after that script has set `data-motion` on `<html>`, so a failed script never hides content.
- **Easing:** `--ease-out-soft`. Anchor links scroll smoothly.
- **Reduced motion:** all of it is off under `prefers-reduced-motion`.
- **Don't add:** hover lifts on cards or looping animations.

## Layout

Max width 6xl with 20/32 px gutters. Bands that sit on paper (why-now, rules, join) are rounded 2xl panels inset 12–20 px from the viewport edge. Nav is a sticky dark pill. Buttons are 48 px tall, radius md, with an SVG arrow rather than a text arrow.

## Honesty rules on the page

- The agent card is labelled "Preview" with a caption saying the figures are examples and no agent is live.
- Stats carry footnotes to their sources.
- The footer and the rules band both say the contracts are unaudited.

## Preview images

- `public/og.png` and `og-builders.png` are static: `pnpm og` renders `scripts/og/card.html` with headless Chrome.
- Agent cards (`/og/agent/:id.png`) are drawn per request in the Worker from `app/og/agent-card.tsx` with satori, using the static fontsource WOFF files (satori can't read WOFF2 or variable fonts). Same night ground and type as the static cards, no halftone: the card shows the agent's real figures, and a rising chart behind a losing agent would mislead.

## Icons and logos

- Phosphor icons (`@phosphor-icons/react`), duotone weight, on a few card sets only: the problem cards and rules cards on `/`, the benefit cards and agent/vault split on `/builders`. Nowhere else.
- Headings and display lines carry no full stop at the end.
- Partner logos in `public/logos/` (Monad, Kuru, Perpl, Agora for AUSD), taken from each project's own site, shown greyscale at 60% and full colour on hover.
