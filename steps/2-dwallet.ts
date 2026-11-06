// Step 2: create a dWallet.
//
// You ask the ika network for a new secp256k1 key. The network writes a
// DWallet account on Solana that holds its public key, owned by your Solana
// wallet. It leaves your share of the key waiting on Solana, encrypted to
// you. You accept the share in a Solana transaction, and from then on the
// dWallet can sign.
//
// One secp256k1 key is an Ethereum account and a Bitcoin address at the same
// time, so this step prints both.

import { Curve } from '@ika.xyz/sdk-solana/web3';

import { bitcoinAddress, ethereumAddress } from '../lib/chains.ts';
import {
	bytesToHex,
	done,
	ikaClient,
	loadKeys,
	loadWallet,
	saveState,
	send,
	show,
	step,
} from '../lib/ika.ts';

const wallet = loadWallet();
const keys = await loadKeys();

step('Asking the ika network for a new secp256k1 dWallet');
const { dWallet } = await ikaClient.requestDWalletDKG({
	curve: Curve.SECP256K1,
	userShareEncryptionKeys: keys,
	owner: wallet.publicKey,
});
done('The network made the key and signed what it made');

step('Accepting your share on Solana');
await send(wallet, keys, (ikaTx) => ikaTx.acceptEncryptedUserShare({ dWallet }));
const address = await ikaClient.waitForDWallet(dWallet);
done('The dWallet is active');

saveState('dwallet.json', { address: address.toBase58(), dWallet });

step('Your dWallet');
show('Solana account', address.toBase58());
show('Owner', `${wallet.publicKey.toBase58()} (your wallet)`);
show('Public key', bytesToHex(dWallet.publicKey));
show('Ethereum address', ethereumAddress(dWallet.publicKey));
show('Bitcoin signet address', bitcoinAddress(dWallet.publicKey));

console.log('\nNext: npm run ethereum\n');
