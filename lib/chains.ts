// What a secp256k1 public key is called on Ethereum and on Bitcoin.
//
// A dWallet is just a key. The same secp256k1 key is an Ethereum account and
// a Bitcoin address at once: only the encoding differs.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as bitcoin from 'bitcoinjs-lib';
import { publicKeyToAddress } from 'viem/utils';

import { bytesToHex } from './ika.ts';

/** The 65-byte uncompressed form of a secp256k1 public key. */
export function uncompressed(publicKey: Uint8Array): Uint8Array {
	return secp256k1.Point.fromBytes(publicKey).toBytes(false);
}

/** The 33-byte compressed form, which Bitcoin uses. */
export function compressed(publicKey: Uint8Array): Uint8Array {
	return secp256k1.Point.fromBytes(publicKey).toBytes(true);
}

/** The Ethereum address: the last 20 bytes of the Keccak-256 of the uncompressed key. */
export function ethereumAddress(publicKey: Uint8Array): `0x${string}` {
	return publicKeyToAddress(`0x${bytesToHex(uncompressed(publicKey))}`);
}

/** Bitcoin signet uses the testnet address format (tb1...). */
export const SIGNET = bitcoin.networks.testnet;

/** The native SegWit (P2WPKH) address of the key on signet. */
export function bitcoinAddress(publicKey: Uint8Array): string {
	return bitcoin.payments.p2wpkh({ pubkey: compressed(publicKey), network: SIGNET }).address!;
}

/**
 * The parts of a 65-byte ECDSA signature from the ika network: the recovery
 * byte, then `r`, then `s`. The network always returns a low `s`.
 */
export function splitSignature(signature: Uint8Array): {
	recovery: number;
	r: Uint8Array;
	s: Uint8Array;
} {
	if (signature.length !== 65)
		throw new Error(`expected a 65-byte signature, got ${signature.length} bytes`);
	return { recovery: signature[0], r: signature.subarray(1, 33), s: signature.subarray(33, 65) };
}
