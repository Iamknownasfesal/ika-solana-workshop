// Step 4: sign a Bitcoin transaction with the same dWallet.
//
// The same key, the same four moves as on Ethereum. What changes is what
// Bitcoin signs. A native SegWit (P2WPKH) input is signed over its BIP143
// preimage: a fixed list of the transaction's fields. Bitcoin hashes that
// preimage with SHA-256 twice, so we ask for ECDSA on secp256k1 with double
// SHA-256 over the preimage.
//
// This step spends the first coin it finds at your dWallet's signet address.
// With no coin yet, it signs a spend of a made-up coin instead, so you still
// see the whole flow; that one cannot be broadcast.

import { Hash, SignatureAlgorithm } from '@ika.xyz/pre-alpha-solana/web3';
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { PublicKey } from '@solana/web3.js';
import * as bitcoin from 'bitcoinjs-lib';

import { bitcoinAddress, compressed, SIGNET, splitSignature } from '../lib/chains.ts';
import { SIGNET_API_URL } from '../lib/config.ts';
import {
	bytesToHex,
	done,
	hexToBytes,
	ikaClient,
	loadDWallet,
	loadKeys,
	loadWallet,
	send,
	show,
	step,
} from '../lib/ika.ts';

const FEE = 300n; // satoshis

const wallet = loadWallet();
const keys = await loadKeys();
const dWallet = loadDWallet();
const publicKey = compressed(dWallet.publicKey);
const address = bitcoinAddress(dWallet.publicKey);
const to = process.env.TO ?? address; // default: send to yourself

step("Finding a coin at your dWallet's signet address");
show('Address', address);
const coins = (await fetch(`${SIGNET_API_URL}/address/${address}/utxo`).then((r) => r.json())) as {
	txid: string;
	vout: number;
	value: number;
}[];
const coin = coins[0] ?? { txid: '00'.repeat(32), vout: 0, value: 10_000 };
const real = coins.length > 0;
if (real) {
	done(`Found ${coin.value} sats in ${coin.txid}:${coin.vout}`);
} else {
	console.log(
		'  No coin yet. Signing a spend of a made-up 10,000-sat coin, which cannot be broadcast.',
	);
	console.log(`  Get signet coins for ${address} from a signet faucet, then run this step again.`);
}

step('Building an unsigned transaction');
const tx = new bitcoin.Transaction();
tx.version = 2;
tx.addInput(hexToBytes(coin.txid).reverse(), coin.vout); // Bitcoin writes txids backwards
tx.addOutput(bitcoin.address.toOutputScript(to, SIGNET), BigInt(coin.value) - FEE);
show('Spending', `${coin.value} sats → ${BigInt(coin.value) - FEE} sats to ${to}, ${FEE} sats fee`);

// The BIP143 preimage of input 0. For P2WPKH the "script code" is the classic
// pay-to-public-key-hash script of the key.
const pubkeyHash = bitcoin.crypto.hash160(publicKey);
const scriptCode = bitcoin.script.compile([
	bitcoin.opcodes.OP_DUP,
	bitcoin.opcodes.OP_HASH160,
	pubkeyHash,
	bitcoin.opcodes.OP_EQUALVERIFY,
	bitcoin.opcodes.OP_CHECKSIG,
]);
const preimage = bip143Preimage(
	tx,
	0,
	scriptCode,
	BigInt(coin.value),
	bitcoin.Transaction.SIGHASH_ALL,
);
// Check our preimage against bitcoinjs-lib's own sighash.
const sighash = sha256(sha256(preimage));
const expected = tx.hashForWitnessV0(
	0,
	scriptCode,
	BigInt(coin.value),
	bitcoin.Transaction.SIGHASH_ALL,
);
if (bytesToHex(sighash) !== bytesToHex(expected)) throw new Error('the BIP143 preimage is wrong');
show('BIP143 preimage', bytesToHex(preimage));
show('Sighash (double SHA-256)', bytesToHex(sighash));

const scheme = {
	signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
	hashScheme: Hash.DoubleSHA256,
};

step('Approving it on Solana');
let voucher!: PublicKey;
await send(wallet, keys, async (ikaTx) => {
	voucher = await ikaTx.approveMessage({ dWallet, message: preimage, ...scheme });
});
done(`Signature voucher ${voucher.toBase58()}`);

step('Asking the ika network to sign');
const signature = await ikaClient.requestSign({
	dWallet,
	signatureVoucherId: voucher,
	message: preimage,
	...scheme,
	userShareEncryptionKeys: keys,
});
const { r, s } = splitSignature(signature);
const compact = new Uint8Array([...r, ...s]);
if (!secp256k1.verify(compact, sighash, publicKey, { prehash: false, lowS: true })) {
	throw new Error("the signature does not verify under the dWallet's key");
}
done("Signed, and the signature verifies under your dWallet's key");

step('Putting the signature into the transaction');
// Bitcoin wants the signature DER-encoded, followed by the sighash type.
tx.setWitness(0, [
	bitcoin.script.signature.encode(compact, bitcoin.Transaction.SIGHASH_ALL),
	publicKey,
]);
const raw = tx.toHex();
show('Signed transaction', raw);
show('Transaction id', tx.getId());

step('Sending it to signet');
if (!real) {
	console.log('  Skipped: this spends a made-up coin. Fund your address and run the step again.');
} else {
	const response = await fetch(`${SIGNET_API_URL}/tx`, { method: 'POST', body: raw });
	if (!response.ok) throw new Error(`signet refused the transaction: ${await response.text()}`);
	done(`Sent: https://mempool.space/signet/tx/${await response.text()}`);
}

console.log('\nNext (optional): npm run program\n');

/** The BIP143 signature preimage of input `index`, for SegWit version 0. */
function bip143Preimage(
	transaction: bitcoin.Transaction,
	index: number,
	scriptCode: Uint8Array,
	amount: bigint,
	hashType: number,
): Uint8Array {
	const u32 = (n: number) => {
		const b = new Uint8Array(4);
		new DataView(b.buffer).setUint32(0, n, true);
		return b;
	};
	const u64 = (n: bigint) => {
		const b = new Uint8Array(8);
		new DataView(b.buffer).setBigUint64(0, n, true);
		return b;
	};
	const hash256 = (b: Uint8Array) => sha256(sha256(b));
	const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
	const varSlice = (b: Uint8Array) => concat(Uint8Array.of(b.length), b);

	const outpoints = concat(...transaction.ins.map((i) => concat(i.hash, u32(i.index))));
	const sequences = concat(...transaction.ins.map((i) => u32(i.sequence)));
	const outputs = concat(...transaction.outs.map((o) => concat(u64(o.value), varSlice(o.script))));
	const input = transaction.ins[index];
	return concat(
		u32(transaction.version),
		hash256(outpoints),
		hash256(sequences),
		input.hash,
		u32(input.index),
		varSlice(scriptCode),
		u64(amount),
		u32(input.sequence),
		hash256(outputs),
		u32(transaction.locktime),
		u32(hashType),
	);
}
