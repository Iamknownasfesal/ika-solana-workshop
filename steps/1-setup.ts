// Step 1: become a user of the ika network.
//
// You need two things on Solana before the network will make you a dWallet:
//
// 1. Your encryption key, registered on chain. The network encrypts your
//    share of each dWallet to it, so only you can read your share.
// 2. A gas deposit, for your request key. Every request you send to the
//    network is signed by that key and charged to its deposit. The
//    pre-alpha charges nothing, but the deposit must exist.
//
// Both keys come from one root seed, which this step makes and saves in
// .workshop/seed.json.

import { encryptionKeyPda, gasDepositPda } from '@ika.xyz/sdk-solana';
import { Curve } from '@ika.xyz/sdk-solana/web3';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import {
	bytesToHex,
	connection,
	done,
	ikaClient,
	loadKeys,
	loadState,
	loadWallet,
	programId,
	saveState,
	send,
	show,
	step,
} from '../lib/ika.ts';

const wallet = loadWallet();
step('Your Solana devnet wallet');
show('Address', wallet.publicKey.toBase58());
const balance = (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
show('Balance', `${balance} SOL`);
if (balance < 0.05) {
	throw new Error('you need at least 0.05 devnet SOL: get some at https://faucet.solana.com');
}

step('Your root seed');
if (loadState('seed.json') === undefined) {
	saveState('seed.json', { rootSeed: bytesToHex(crypto.getRandomValues(new Uint8Array(32))) });
	done('Made a new root seed and saved it in .workshop/seed.json (keep it secret)');
} else {
	done('Using the root seed already in .workshop/seed.json');
}
const keys = await loadKeys();
show('Request key', bytesToHex(ikaClient.getRequestPublicKey(keys)));

// Each of these is an account of the ika program, at an address derived
// from your keys. If it is there already, an earlier run made it.
const exists = async (address: Uint8Array) =>
	(await connection.getAccountInfo(new PublicKey(address))) !== null;
const SECP256K1 = 0; // the curve's number on Solana

step('Registering your encryption key on Solana');
if (
	await exists(
		encryptionKeyPda(programId.toBytes(), keys.getSigningPublicKeyBytes(), SECP256K1).address,
	)
) {
	done('Already registered');
} else {
	// It takes most of a Solana transaction, so it goes in one of its own.
	await send(wallet, keys, (ikaTx) => ikaTx.registerEncryptionKey({ curve: Curve.SECP256K1 }));
	done('Encryption key registered');
}

step('Opening your gas deposit');
if (await exists(gasDepositPda(programId.toBytes(), ikaClient.getRequestPublicKey(keys)).address)) {
	done('Already open');
} else {
	await send(wallet, keys, (ikaTx) => ikaTx.createGasDeposit());
	done('Gas deposit opened');
}

console.log('\nNext: npm run dwallet\n');
