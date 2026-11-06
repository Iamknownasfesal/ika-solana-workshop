// Step 5 (optional): let a Solana program decide what your dWallet signs.
//
// So far your wallet owned the dWallet, so your wallet approved each message.
// Here a program owns it: the example voting program. A council of two
// members votes on a message, and when both vote yes, the program issues the
// signature voucher itself. Nobody's wallet can approve a message any more,
// yours included. Only the vote can.
//
// This step makes a second dWallet for the program, so the one from step 2
// stays yours.

import { readSignatureVoucherUnverified } from '@ika.xyz/sdk-solana';
import { coordinatorAddress } from '@ika.xyz/sdk-solana/instructions';
import { approvalMessageDigests } from '@ika.xyz/sdk-solana';
import { Curve, Hash, SignatureAlgorithm } from '@ika.xyz/sdk-solana/web3';
import { Keypair, PublicKey } from '@solana/web3.js';
import { recoverMessageAddress, toHex, toPrefixedMessage } from 'viem';

import { ethereumAddress, splitSignature } from '../lib/chains.ts';
import { VOTING_PROGRAM_ID } from '../lib/config.ts';
import {
	connection,
	done,
	hexToBytes,
	ikaClient,
	loadKeys,
	loadWallet,
	programId,
	send,
	show,
	sleep,
	step,
} from '../lib/ika.ts';
import {
	castVote,
	cpiAuthority,
	createCouncil,
	createProposal,
	voucherAddress,
} from '../lib/voting.ts';

const ECDSA_KECCAK256 = 0; // the signature scheme's number on Solana

const voting = new PublicKey(VOTING_PROGRAM_ID);
const wallet = loadWallet();
const keys = await loadKeys();

step('Creating a dWallet for the program');
const { dWallet } = await ikaClient.requestDWalletDKG({
	curve: Curve.SECP256K1,
	userShareEncryptionKeys: keys,
	owner: wallet.publicKey,
});
await send(wallet, keys, (ikaTx) => ikaTx.acceptEncryptedUserShare({ dWallet }));
const dwallet = await ikaClient.waitForDWallet(dWallet);
show('dWallet', dwallet.toBase58());
show('Its Ethereum address', ethereumAddress(dWallet.publicKey));

step('Creating a council of two, quorum two');
// The members only sign their votes. Your wallet pays for everything.
const members = [Keypair.generate(), Keypair.generate()];
// The council must exist before the hand-over: creating it needs the
// dWallet's owner, and after the hand-over that is the program.
await send(wallet, keys, () => undefined, {
	instructions: [
		createCouncil({
			program: voting,
			ikaProgram: programId,
			dwallet,
			owner: wallet.publicKey,
			members: members.map((m) => m.publicKey),
			quorum: 2,
		}),
	],
});
done('Council created');

step('Handing the dWallet to the voting program');
const [authority] = cpiAuthority(voting);
await send(wallet, keys, (ikaTx) => ikaTx.transferDWallet({ dWallet, newOwner: authority }));
done(`The dWallet's owner is now the program's address ${authority.toBase58()}`);

step('Proposing a message');
// An Ethereum signed message (EIP-191), the kind a dapp asks a wallet to sign.
const text = `Signed by a Solana vote at ${new Date().toISOString()}`;
const message = hexToBytes(toPrefixedMessage(text));
const id = Keypair.generate().publicKey.toBytes();
await send(wallet, keys, () => undefined, {
	instructions: [
		createProposal({
			program: voting,
			dwallet,
			proposer: members[0].publicKey,
			payer: wallet.publicKey,
			id,
			messageDigest: approvalMessageDigests(message).messageDigest,
			requestKey: ikaClient.getRequestPublicKey(keys), // who may ask the network to sign
			signatureScheme: ECDSA_KECCAK256,
		}),
	],
	signers: [members[0]],
});
show('Message', text);

step('Voting');
for (const [i, member] of members.entries()) {
	await send(wallet, keys, () => undefined, {
		instructions: [
			castVote({
				program: voting,
				ikaProgram: programId,
				coordinator: coordinatorAddress(programId),
				dwallet,
				voter: member.publicKey,
				payer: wallet.publicKey,
				id,
				reachesQuorum: i === members.length - 1,
			}),
		],
		signers: [member],
	});
	done(`Member ${i + 1} voted yes`);
}

const [voucher] = voucherAddress(voting, id);
// The network reads the voucher at finalized commitment.
for (;;) {
	const account = await connection.getAccountInfo(voucher, 'finalized');
	if (account && readSignatureVoucherUnverified(account.data)) break;
	await sleep(1_000);
}
done(`The program issued the voucher ${voucher.toBase58()}`);

step("Asking the ika network to sign, under the program's voucher");
const signature = await ikaClient.requestSign({
	dWallet,
	signatureVoucherId: voucher,
	message,
	signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
	hashScheme: Hash.KECCAK256,
	userShareEncryptionKeys: keys,
});
const { recovery, r, s } = splitSignature(signature);
const ethSignature =
	`${toHex(r)}${toHex(s).slice(2)}${(27 + (recovery & 1)).toString(16)}` as `0x${string}`;
const signer = await recoverMessageAddress({ message: text, signature: ethSignature });
if (signer.toLowerCase() !== ethereumAddress(dWallet.publicKey).toLowerCase()) {
	throw new Error(`the signature recovers to ${signer}, not the dWallet's address`);
}
done(`Signed. Any Ethereum tool recovers the signer as ${signer}`);
show('Signature', ethSignature);

console.log(
	'\nThat is the whole idea: Solana logic decides, and the dWallet signs on any chain.\n',
);
