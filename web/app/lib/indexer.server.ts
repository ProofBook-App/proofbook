// Envio HyperIndex GraphQL (Hasura). BigInt fields come back as decimal strings.
// The URL changes with every Envio Cloud deployment; it lives in wrangler.jsonc vars.

export class IndexerError extends Error {}

export async function gql<T>(url: string, query: string, variables: Record<string, unknown> = {}, timeoutMs = 8000) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new IndexerError(`indexer HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new IndexerError(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new IndexerError("indexer returned no data");
  return body.data;
}

export type IndexedVault = {
  id: string;
  asset: string;
  frozen: boolean;
  nav: string;
  totalShares: string;
  sharePrice: string;
  peakSharePrice: string;
  maxDrawdownBps: number;
  deposited: string;
  withdrawn: string;
  feesPaid: string;
  pnl: string;
  tradeCount: number;
  tradeVolume: string;
  breachCount: number;
  freezeCount: number;
  backerCount: number;
  createdAt: number;
  updatedAt: number;
  agent: {
    id: string;
    owner: string;
    maxTradeNotional: string;
    dailyLossCapBps: number;
    depositCapPerBacker: string;
    venues: string[];
  };
};

export type IndexedPosition = {
  id: string;
  vault: string;
  perpId: string;
  side: string;
  lot: string;
  entryPrice: string;
  deposit: string;
  leverageHdths: string;
  realisedPnl: string;
  funding: string;
  notional: string | null;
  unrealisedPnl: string | null;
  updatedAt: number;
  perp: { markPrice: string | null };
};

export type IndexedNavPoint = {
  id: string;
  vault_id: string;
  nav: string;
  sharePrice: string;
  timestamp: number;
  block: number;
};

export type IndexerMeta = {
  chainId: number;
  progressBlock: number | null;
  sourceBlock: number | null;
  isReady: boolean | null;
};

export type SnapshotData = {
  _meta: IndexerMeta[];
  Vault: IndexedVault[];
  PerplPosition: IndexedPosition[];
  NavPoint: IndexedNavPoint[];
};

export const NAV_POINT_PAGE = 1000;

// Everything the leaderboard needs in one round trip. NavPoints are paged by block so each sync only
// copies what's new (`_gte` re-reads the last block, and the upsert makes that harmless).
export const SNAPSHOT_QUERY = /* GraphQL */ `
  query Snapshot($chainId: Int!, $sinceBlock: Int!, $navLimit: Int!) {
    _meta(where: { chainId: { _eq: $chainId } }) {
      chainId
      progressBlock
      sourceBlock
      isReady
    }
    Vault(order_by: { id: asc }) {
      id
      asset
      frozen
      nav
      totalShares
      sharePrice
      peakSharePrice
      maxDrawdownBps
      deposited
      withdrawn
      feesPaid
      pnl
      tradeCount
      tradeVolume
      breachCount
      freezeCount
      backerCount
      createdAt
      updatedAt
      agent {
        id
        owner
        maxTradeNotional
        dailyLossCapBps
        depositCapPerBacker
        venues
      }
    }
    PerplPosition(where: { lot: { _gt: "0" } }, order_by: { id: asc }) {
      id
      vault
      perpId
      side
      lot
      entryPrice
      deposit
      leverageHdths
      realisedPnl
      funding
      notional
      unrealisedPnl
      updatedAt
      perp {
        markPrice
      }
    }
    NavPoint(where: { block: { _gte: $sinceBlock } }, order_by: [{ block: asc }, { id: asc }], limit: $navLimit) {
      id
      vault_id
      nav
      sharePrice
      timestamp
      block
    }
  }
`;

export type IndexedActivity = {
  Trade: {
    id: string;
    venue: string;
    notional: string;
    venueDelta: string;
    navBefore: string;
    navAfter: string;
    timestamp: number;
    txHash: string;
  }[];
  PolicyEvent: { id: string; kind: string; by: string | null; nav: string | null; timestamp: number; txHash: string }[];
  Flow: { id: string; kind: string; account: string; assets: string; timestamp: number; txHash: string }[];
};

// A vault's latest activity, read live on the agent profile rather than snapshotted.
export const ACTIVITY_QUERY = /* GraphQL */ `
  query Activity($vault: String!, $limit: Int!) {
    Trade(where: { vault_id: { _eq: $vault } }, order_by: { block: desc }, limit: $limit) {
      id
      venue
      notional
      venueDelta
      navBefore
      navAfter
      timestamp
      txHash
    }
    PolicyEvent(where: { vault_id: { _eq: $vault } }, order_by: { timestamp: desc }, limit: $limit) {
      id
      kind
      by
      nav
      timestamp
      txHash
    }
    Flow(where: { vault_id: { _eq: $vault } }, order_by: { timestamp: desc }, limit: $limit) {
      id
      kind
      account
      assets
      timestamp
      txHash
    }
  }
`;
