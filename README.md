# One key, every chain: a dWallet on Solana

In this workshop you create a **dWallet** that your Solana devnet account controls, and use it to
sign a real **Ethereum** transaction and a real **Bitcoin** transaction. Then, optionally, you hand
it to a **Solana program**, so that a vote decides what it signs.

A dWallet is a signing key that a Solana account controls. Its owner decides which messages it
signs, and the ika network produces the signatures. The same secp256k1 key is an Ethereum account
and a Bitcoin address at once, so one Solana account, or one Solana program, can hold and move
assets on other chains.

> **This runs on the ika devnet pre-alpha, which is a mock.** One server stands in for the whole
> ika network. It holds an ordinary key for each dWallet and signs with it alone. There is no MPC,
> and the server can sign anything with any dWallet. **Never put real funds on these addresses.**
> Use only devnet, Sepolia and signet coins. The Solana program, the transactions and the SDK calls
> are the ones the real network uses, so what you learn here carries over.

## What you need

- **Node.js 22.12 or later** (`node --version`).
- **A Solana devnet keypair with about 0.2 SOL.** Make one with
  `solana-keygen new -o ~/.config/solana/id.json` (or any wallet's exported keypair file), and get
  devnet SOL from <https://faucet.solana.com>.
- Optional, to broadcast what you sign: a little **Sepolia ETH** and some **signet BTC** at your
  dWallet's addresses. Step 2 prints them. Without them, every step still signs and checks the
  transaction; only the final broadcast is skipped.

## Setup

```bash
git clone https://github.com/iamknownasfesal/ika-solana-workshop
cd ika-solana-workshop
npm install
```

If your keypair is not at `~/.config/solana/id.json`, point the workshop at it:

```bash
export KEYPAIR=/path/to/your/devnet-keypair.json
```

## The steps

Each step is one short file in `steps/`. Read it before you run it: the comments at the top say
what it does and why.

### 1. Become an ika user — `npm run setup`

Makes your **root seed** (saved in `.workshop/seed.json`; every ika key you have comes from it),
registers your **encryption key** on Solana, and opens your **gas deposit**.

Look for: `✓ Encryption key registered` and `✓ Gas deposit opened`.

### 2. Create your dWallet — `npm run dwallet`

Asks the ika network for a new secp256k1 key. The network writes a `DWallet` account on Solana,
owned by your wallet, and leaves your share of the key waiting there. You accept the share, and the
dWallet is live.

Look for: your dWallet's **Ethereum address** (`0x…`) and **Bitcoin signet address** (`tb1q…`).
Same key, two encodings.

### 3. Sign an Ethereum transaction — `npm run ethereum`

Builds an unsigned Sepolia transaction, approves it on Solana with a **signature voucher**, asks the
ika network to sign it, and checks that the signed transaction recovers to your dWallet's address.
If the address holds Sepolia ETH, it broadcasts.

Look for: `✓ The signature recovers to your dWallet's address`. Set `TO=0x…` and `AMOUNT=0.001` to
send real Sepolia ETH somewhere.

### 4. Sign a Bitcoin transaction — `npm run bitcoin`

Builds a native SegWit spend on signet, computes the BIP143 preimage Bitcoin signs, has the ika
network sign it, DER-encodes the signature into the witness, and checks it under your dWallet's
key. If the address holds a signet coin, it broadcasts. Without a coin, it signs a made-up spend so
you still see the whole flow.

Look for: `✓ Signed, and the signature verifies under your dWallet's key`.

### 5. Let a program decide (optional) — `npm run program`

Makes a second dWallet and hands it to the example **voting program** on Solana devnet. A council of
two votes on an Ethereum message. When both vote yes, the program itself issues the voucher, and
the ika network signs. Your wallet can no longer approve anything for that dWallet: only the vote
can.

Look for: `✓ The program issued the voucher` and `✓ Signed. Any Ethereum tool recovers the signer`.

## How it fits together

```
your Solana wallet ──owns──▶ dWallet account (on Solana)
        │                          │
        │ 1. approve a message      │ the ika network reads it
        ▼                          ▼
 signature voucher (on Solana) ──▶ ika network ──▶ signature
                                                     │
                                                     ▼
                                  put it into an Ethereum or Bitcoin transaction
```

- `lib/ika.ts` creates the ika client in mock mode, sends Solana transactions, and saves state.
- `lib/chains.ts` turns the dWallet's key into Ethereum and Bitcoin addresses.
- `lib/voting.ts` builds the voting program's instructions.
- `lib/config.ts` holds every address and URL, each overridable by an environment variable.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `you need at least 0.05 devnet SOL` | Get devnet SOL from <https://faucet.solana.com>. |
| `Server responded with 429 Too Many Requests` | The public Solana devnet RPC limits its rate. It retries by itself. If it keeps failing, use a free devnet RPC from a provider (Helius, QuickNode, Alchemy, …): `export RPC_URL=https://…`. |
| `transaction … expired before it landed` | Devnet was busy. Run the same step again. |
| `no root seed yet` / `no dWallet yet` | Run the earlier steps first: `setup`, then `dwallet`. |
| `mock values need the SDK's mock feature` | The client was made without `withMockCryptography`. The pre-alpha needs it. |
| The Sepolia or signet broadcast is skipped | Fund the address step 2 printed from a Sepolia or signet faucet, and run the step again. |

The workshop confirms Solana transactions by polling over HTTP, so it works with RPCs that refuse
WebSocket connections.

## Learn more

- The ika pre-alpha SDK, docs and examples: <https://github.com/dwallet-labs/ika-pre-alpha>
- The devnet pre-alpha's addresses: `docs/src/getting-started/devnet.md` in that repository.
- Writing your own Solana program that owns dWallets: the "On-Chain Integration" and "Tutorial"
  parts of the docs there.

## License

BSD-3-Clause-Clear. See [LICENSE](./LICENSE).
