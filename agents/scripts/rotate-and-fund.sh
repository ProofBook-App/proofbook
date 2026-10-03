#!/usr/bin/env bash
# HUMAN-RUN. Monad TESTNET (10143) only. Moves a house agent's session key to its Privy wallet and
# sends that wallet test MON for gas. Both are real (testnet) transactions; read before running.
# Defaults to house agent #1; for another agent set AGENT_ID and VAULT too.
#
#   cd agents
#   set -a; source ../.env; set +a        # DEPLOYER_PK (the agent owner), optionally FUNDER_PK
#   PRIVY_WALLET=0x<address printed by privy-setup.mjs> ./scripts/rotate-and-fund.sh
#
# Who may rotate: AgentVault.rotateSessionKey(address next) is onlyAgentOwner, i.e. the live
# ERC-8004 owner of the agent id (AgentRegistry.ownerOf). For #1951 that is 0x3faE…9F51, the deployer
# (DEPLOYER_PK). The vault emits SessionKeyRotated(old, new); the old key 0xB41a…2Bf2 stops working at once.
#
# Gas: Monad charges the whole gas limit, so every limit is `cast estimate` + 5% (rotate ≈ 84k on
# 2026-10-02) and the MON transfer is exactly 21000.
#
# MON reserve: Monad expects every EOA to keep 10 MON; a tx that dips below it reverts and still pays
# gas. The script refuses to send if the funder would end below RESERVE (default 10 MON) after the
# transfer. On 2026-10-02 the deployer held ~10.38 testnet MON, so fund from another wallet
# (FUNDER_PK) or top the deployer up at https://testnet.monad.xyz first. The current session key
# 0xB41a…2Bf2 trades fine at ~4.6 MON on testnet; on mainnet give the Privy wallet > 10 MON.
set -euo pipefail

RPC="${RPC_URL:-https://testnet-rpc.monad.xyz}"
AGENT_ID="${AGENT_ID:-1951}"
VAULT="${VAULT:-0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53}"   # house agent #1 (agent #1951)
[ "$AGENT_ID" = "1951" ] || [ "$VAULT" != "0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53" ] || { echo "AGENT_ID is $AGENT_ID but VAULT is still #1951's; set VAULT." >&2; exit 1; }
AMOUNT="${AMOUNT:-3ether}"                                      # MON for the Privy wallet's gas
RESERVE_WEI="${RESERVE_WEI:-10000000000000000000}"              # 10 MON
: "${PRIVY_WALLET:?set PRIVY_WALLET to the address privy-setup.mjs printed}"
: "${DEPLOYER_PK:?set DEPLOYER_PK (the agent owner key) in the environment}"
FUNDER_PK="${FUNDER_PK:-$DEPLOYER_PK}"

chain=$(cast chain-id --rpc-url "$RPC")
[ "$chain" = "10143" ] || { echo "RPC is chain $chain, not testnet 10143; refusing." >&2; exit 1; }

owner=$(cast wallet address --private-key "$DEPLOYER_PK")
funder=$(cast wallet address --private-key "$FUNDER_PK")
agent_owner=$(cast call 0x25D4934840Ce6fFE1a1b0bbb7814aDB5623a8ABC 'ownerOf(uint256)(address)' "$AGENT_ID" --rpc-url "$RPC")
registered=$(cast call 0x25D4934840Ce6fFE1a1b0bbb7814aDB5623a8ABC 'vaultOf(uint256)(address)' "$AGENT_ID" --rpc-url "$RPC")
[ "$(echo "$registered" | tr A-F a-f)" = "$(echo "$VAULT" | tr A-F a-f)" ] || { echo "agent $AGENT_ID's vault is $registered, not $VAULT; refusing." >&2; exit 1; }
current=$(cast call "$VAULT" 'sessionKey()(address)' --rpc-url "$RPC")
echo "vault           $VAULT"
echo "agent owner     $agent_owner (signing as $owner)"
echo "session key now $current"
echo "privy wallet    $PRIVY_WALLET"
[ "$(echo "$owner" | tr A-F a-f)" = "$(echo "$agent_owner" | tr A-F a-f)" ] || { echo "DEPLOYER_PK is not the agent owner; refusing." >&2; exit 1; }

# ---- 1. rotate the session key (skipped if already done)
if [ "$(echo "$current" | tr A-F a-f)" = "$(echo "$PRIVY_WALLET" | tr A-F a-f)" ]; then
  echo "session key is already the Privy wallet; skipping rotate"
else
  est=$(cast estimate --from "$owner" "$VAULT" 'rotateSessionKey(address)' "$PRIVY_WALLET" --rpc-url "$RPC")
  limit=$(( est * 105 / 100 ))
  read -r -p "rotateSessionKey($PRIVY_WALLET), gas limit $limit. Send? [y/N] " ok
  [ "$ok" = "y" ] || exit 1
  cast send "$VAULT" 'rotateSessionKey(address)' "$PRIVY_WALLET" --gas-limit "$limit" --private-key "$DEPLOYER_PK" --rpc-url "$RPC"
  echo "session key now $(cast call "$VAULT" 'sessionKey()(address)' --rpc-url "$RPC")"
fi

# ---- 2. fund the Privy wallet with test MON for gas
value_wei=$(cast to-wei "${AMOUNT%ether}")
bal=$(cast balance "$funder" --rpc-url "$RPC")
gasprice=$(cast gas-price --rpc-url "$RPC")
after=$(python3 -c "print($bal - $value_wei - 21000 * $gasprice * 2)")
echo "funder          $funder holds $(cast from-wei "$bal") MON; after sending $AMOUNT: ~$(cast from-wei "${after#-}") MON$( [ "${after:0:1}" = "-" ] && echo ' (NEGATIVE)')"
if python3 -c "import sys; sys.exit(0 if $after >= $RESERVE_WEI else 1)"; then :; else
  echo "That leaves the funder under the 10 MON reserve. Use another FUNDER_PK, a smaller AMOUNT, or top up first." >&2
  exit 1
fi
read -r -p "Send $AMOUNT MON to $PRIVY_WALLET (gas limit 21000)? [y/N] " ok
[ "$ok" = "y" ] || exit 1
cast send "$PRIVY_WALLET" --value "${AMOUNT%ether}ether" --gas-limit 21000 --private-key "$FUNDER_PK" --rpc-url "$RPC"
echo "privy wallet    $(cast balance "$PRIVY_WALLET" --rpc-url "$RPC" --ether) MON"
echo
echo "Next (agents/README.md, Going live): set MODE to \"live\" in wrangler.jsonc, apply the D1 migration remotely, wrangler deploy."
