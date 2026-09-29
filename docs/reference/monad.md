# Monad mainnet reference

Researched 2026-09-28. ✅ means checked onchain against chain 143. ⚠️ means unverified.

## Network

| Item | Value |
|---|---|
| Chain ID | **143** ✅ (testnet 10143, RPC `https://testnet-rpc.monad.xyz`, faucet https://testnet.monad.xyz) |
| Native token | MON |
| Public RPCs | `https://rpc.monad.xyz` (QuickNode, 25 rps, batch 100), `rpc1.monad.xyz` (Alchemy, 15 rps), `rpc2.monad.xyz` (Goldsky), `rpc3.monad.xyz` (Ankr), `rpc-mainnet.monadinfra.com` (batch 1) |
| Alchemy (secondary) | `https://monad-mainnet.g.alchemy.com/v2/<KEY>` |
| Explorers | MonadVision https://monadvision.com (Sourcify-based), Monadscan https://monadscan.com (Etherscan-based) |
| viem chain | `import { monad } from "viem/chains"` (id 143) |
| Block time / finality | 300 ms / 600 ms (since 2026-07-23) |

Source: https://docs.monad.xyz/developer-essentials/network-information

## Contract verification

```bash
# MonadVision (Sourcify)
forge verify-contract <addr> <Name> --chain 143 --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
# Monadscan (Etherscan)
forge verify-contract <addr> <Name> --chain 143 --verifier etherscan --etherscan-api-key $KEY --watch
```

- Some Foundry versions fail with "No known Etherscan API URL for chain 143". Pass `--verifier-url "https://api.etherscan.io/v2/api?chainid=143"` ⚠️.
- Sourcify verification needs `metadata = true`, `metadata_hash = "none"` and `use_literal_content = true` in `foundry.toml`.

Source: https://docs.monad.xyz/guides/verify-smart-contract/foundry

## Foundry

- **Version and config:** Monad docs require Foundry **≥ 1.8** with `network = "monad"` in `foundry.toml`. This applies Monad's gas model, opcode pricing and size limits in tests and scripts. Checked 2026-09-29: Foundry 1.8.3 accepts `network = "monad"`, but it rejects the template's `metadata`/`metadata_hash` keys, so use `bytecode_hash = "none"`.
- **EVM version:** Monad is bytecode-compatible through Osaka, so set `evm_version = "osaka"` ⚠️ (from a docs search summary).
- **Alternative:** the Category Labs fork (`foundryup --network monad`) adds `anvil --monad`.
- **Template:** https://github.com/monad-developers/foundry-monad

## EVM differences

Source: https://docs.monad.xyz/developer-essentials/differences

- **Gas is charged on the gas limit, not on gas used** (`value + gas_bid * gas_limit`).
- **Reserve balance: every EOA keeps 10 MON.**
  - If a tx's value spend would take the balance below 10 MON, it reverts and still pays gas.
  - An undelegated account gets one "emptying" tx per ~1.2 s.
  - Contracts can check this via precompile `0x1001` `dippedIntoReserve()`.
  - Source: https://docs.monad.xyz/developer-essentials/reserve-balance
- **EIP-7702-delegated EOAs** must keep 10 MON and cannot CREATE/CREATE2.
- **Size limits:** max code size 128 KB, max initcode 256 KB.
- **Pricing:** memory expansion is linear and capped at 8 MB per tx. Storage is warmed per 128-slot page.
- **Precompiles:** P256 verify at `0x0100`.
- **Not available:** no blob txs (type 3), no global mempool, and full nodes don't serve arbitrary historical state.
- **`eth_estimateGas`:** calls with gas ≤ 8.1M run in a low-gas pool. Larger ones go to a high-gas pool.

## Canonical addresses (mainnet)

| Contract | Address |
|---|---|
| AUSD (Agora) | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` ✅, 6 decimals ✅, ERC-2612 permit + ERC-3009 |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (6 dp) |
| USDT0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` (6 dp) |
| WMON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` (18 dp) |
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` ✅ |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` ✅ |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` |
| CREATE2 deployer (Foundry default) | `0x4e59b44847b379578588920ca78fbf26c0b4956c` |
| CreateX | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` |
| Safe 1.3.0 | `0x69f4D1788e39c87893C980c06EdF4b7f686e2938` |
| ERC-4337 EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |

Token list: https://github.com/monad-crypto/token-list
