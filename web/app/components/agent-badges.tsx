// House agents are always labelled (spec §9), and a frozen vault says so wherever the agent appears.
export function AgentBadges({ house, frozen, dark = false }: { house: boolean; frozen: boolean; dark?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {house && (
        <span
          className={`rounded border border-dashed px-1.5 py-px font-mono text-[11px] ${
            dark ? "border-mist/50 text-mist" : "border-dot/50 text-dot"
          }`}
        >
          House agent
        </span>
      )}
      {frozen && (
        <span className={`rounded px-1.5 py-px font-mono text-[11px] ${dark ? "bg-limit text-paper" : "bg-limit/10 text-limit"}`}>
          Frozen
        </span>
      )}
    </span>
  );
}
