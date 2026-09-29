#!/usr/bin/env python3
"""Create a local .env with fresh TESTNET-ONLY keys (deployer/guardian + house-agent session key).

Run from the repo root:  python3 scripts/make-testnet-env.py
Refuses to overwrite an existing .env. Prints addresses only, never private keys.
"""
import json
import os
import subprocess
import sys

if os.path.exists(".env"):
    sys.exit(".env already exists, not overwriting")

wallets = json.loads(subprocess.check_output(["cast", "wallet", "new", "--number", "2", "--json"]))["data"]
dep, sk = wallets[0], wallets[1]

env = f"""# LOCAL ONLY, gitignored. TESTNET-ONLY keys from `cast wallet new`. Never fund on mainnet.
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
ALCHEMY_MONAD_RPC_URL=
ETHERSCAN_API_KEY=

# Testnet deployer {dep["address"]}. Fund > 10 MON at https://testnet.monad.xyz
DEPLOYER_PK={dep["private_key"]}
# Testnet guardian = deployer. Use a separate wallet on mainnet.
GUARDIAN_ADDRESS={dep["address"]}

# Testnet house agent #1 session key. Needs > 10 MON for gas.
SESSION_KEY_PK_1={sk["private_key"]}
SESSION_KEY_ADDRESS_1={sk["address"]}
SESSION_KEY_PK_2=
SESSION_KEY_PK_3=

PRIVY_APP_ID=
PRIVY_APP_SECRET=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
QWEN_API_KEY=
KIMI_API_KEY=
"""

fd = os.open(".env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(env)

print("deployer/guardian:", dep["address"])
print("session key 1:    ", sk["address"])
