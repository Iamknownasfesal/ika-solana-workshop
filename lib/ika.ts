// Everything the steps share: the connections, your keys, sending a Solana
// transaction, and saving what one step makes for the next.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { withMockCryptography } from '@ika.xyz/sdk-core/mock';
import { DWalletGrpcClient } from '@ika.xyz/sdk-core/web';
import {
	Curve,
	IkaClient,
	IkaTransaction,
	UserShareEncryptionKeys,
} from '@ika.xyz/sdk-solana/web3';
import type { DWallet } from '@ika.xyz/sdk-solana/web3';
import {
	Connection,
	Keypair,
	PublicKey,
	Transaction,
	TransactionInstruction,
} from '@solana/web3.js';

import { IKA, KEYPAIR_PATH, SOLANA_RPC_URL, STATE_DIR } from './config.ts';

export const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
export const programId = new PublicKey(IKA.programId);

/**
 * The ika client, in mock mode.
 *
 * The devnet pre-alpha is a mock ika network: one server holds an ordinary
 * key for each dWallet and signs with it alone. `withMockCryptography` tells
 * the SDK to skip its half of the 2PC-MPC computation. Every other check
 * stays. Against the real network you drop `withMockCryptography` and name
 * the real network; nothing else changes.
 */
export const grpc = new DWalletGrpcClient(IKA.grpcUrl);
export const ikaClient = new IkaClient(
	withMockCryptography({
		connection,
		grpc,
		config: {
			network: { custom: { networkPublicKeys: [hexToBytes(IKA.networkKey)] } },
			programId,
			chainNumber: IKA.chainNumber,
			networkValue: IKA.networkValue,
		},
	}),
);

/** Your Solana devnet wallet. */
export function loadWallet(): Keypair {
	if (!existsSync(KEYPAIR_PATH)) {
		throw new Error(
			`no keypair at ${KEYPAIR_PATH}. Make one with \`solana-keygen new\`, or set KEYPAIR to its path.`,
		);
	}
	return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8'))));
}

/**
 * Your ika keys, for the secp256k1 curve, from your root seed.
 *
 * Every key you have on ika comes from one 32-byte root seed: the key your
 * share is encrypted to, and the request key that signs your requests to the
 * network. Keep the seed secret, and keep it safe: it is how you get your
 * dWallet back later.
 */
export async function loadKeys(): Promise<UserShareEncryptionKeys> {
	const seed = loadState<{ rootSeed: string }>('seed.json')?.rootSeed;
	if (seed === undefined) throw new Error('no root seed yet: run `npm run setup` first');
	return UserShareEncryptionKeys.fromRootSeedKey(hexToBytes(seed), Curve.SECP256K1);
}

/**
 * Send a Solana transaction built by `build`, signed by your wallet, and wait
 * until it is finalized.
 *
 * Finalized, because the ika network reads Solana at finalized commitment:
 * it does not see a voucher or an accepted share before then. The wait polls
 * over HTTP, because public RPCs often refuse the WebSocket that
 * `confirmTransaction` uses.
 */
export async function send<T>(
	wallet: Keypair,
	keys: UserShareEncryptionKeys,
	build: (ikaTx: IkaTransaction) => Promise<T> | T,
	extra: { instructions?: TransactionInstruction[]; signers?: Keypair[] } = {},
): Promise<T> {
	const transaction = new Transaction();
	const ikaTx = new IkaTransaction({
		ikaClient,
		transaction,
		owner: wallet.publicKey,
		userShareEncryptionKeys: keys,
	});
	const built = await build(ikaTx);
	if (extra.instructions) transaction.add(...extra.instructions);
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	transaction.recentBlockhash = blockhash;
	transaction.feePayer = wallet.publicKey;
	// A voucher is a fresh account that signs its own creation.
	transaction.sign(wallet, ...ikaTx.signers, ...(extra.signers ?? []));
	const signature = await connection.sendRawTransaction(transaction.serialize());
	await waitFinalized(signature, lastValidBlockHeight);
	return built;
}

/** Wait until a Solana transaction is finalized, asking the RPC over HTTP. */
export async function waitFinalized(
	signature: string,
	lastValidBlockHeight: number,
): Promise<void> {
	for (;;) {
		const status = (await connection.getSignatureStatuses([signature])).value[0];
		if (status?.err)
			throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
		if (status?.confirmationStatus === 'finalized') return;
		if (status === null && (await connection.getBlockHeight('confirmed')) > lastValidBlockHeight) {
			throw new Error(`transaction ${signature} expired before it landed: run the step again`);
		}
		await sleep(1_000);
	}
}

// ── Saving what a step makes ──

export function saveState(file: string, value: unknown): void {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(join(STATE_DIR, file), JSON.stringify(value, toJson, 2));
}

export function loadState<T>(file: string): T | undefined {
	const path = join(STATE_DIR, file);
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, 'utf8'), fromJson) as T;
}

/** The dWallet step 2 made. The SDK checks it on Solana again before every sign. */
export function loadDWallet(): DWallet {
	const saved = loadState<{ dWallet: DWallet }>('dwallet.json');
	if (saved === undefined) throw new Error('no dWallet yet: run `npm run dwallet` first');
	return saved.dWallet;
}

// JSON has no bytes or bigints, so they are written as tagged hex strings.
function toJson(_key: string, value: unknown): unknown {
	if (value instanceof Uint8Array) return { $bytes: bytesToHex(value) };
	if (typeof value === 'bigint') return { $bigint: value.toString() };
	return value;
}

function fromJson(_key: string, value: unknown): unknown {
	if (value !== null && typeof value === 'object') {
		if ('$bytes' in value) return hexToBytes((value as { $bytes: string }).$bytes);
		if ('$bigint' in value) return BigInt((value as { $bigint: string }).$bigint);
	}
	return value;
}

// ── Small helpers ──

export function hexToBytes(hex: string): Uint8Array {
	return Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
}

export function bytesToHex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('hex');
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const step = (title: string) => console.log(`\n\x1b[1m\x1b[36m▶ ${title}\x1b[0m`);
export const done = (text: string) => console.log(`\x1b[32m  ✓\x1b[0m ${text}`);
export const show = (label: string, value: string | number | bigint) =>
	console.log(`\x1b[33m  →\x1b[0m ${label}: ${value}`);
