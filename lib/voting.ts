// The instructions of the example voting program from ika-pre-alpha
// (examples/voting). A council of members votes on a message. When the yes
// votes reach the quorum, the program issues a signature voucher for the
// council's dWallet, through a CPI to the ika program.

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

const pda = (seeds: (Uint8Array | string)[], programId: PublicKey) =>
	PublicKey.findProgramAddressSync(
		seeds.map((seed) => (typeof seed === 'string' ? Buffer.from(seed) : Buffer.from(seed))),
		programId,
	);

/** The address the program signs its ika calls with. A dWallet given to the program is owned by it. */
export const cpiAuthority = (program: PublicKey) => pda(['__ika_cpi_authority'], program);
export const councilAddress = (program: PublicKey, dwallet: PublicKey) =>
	pda(['council', dwallet.toBytes()], program);
export const proposalAddress = (program: PublicKey, id: Uint8Array) =>
	pda(['proposal', id], program);
export const voteAddress = (program: PublicKey, id: Uint8Array, voter: PublicKey) =>
	pda(['vote', id, voter.toBytes()], program);
/** Where the program puts the voucher of a proposal that passes. */
export const voucherAddress = (program: PublicKey, id: Uint8Array) =>
	pda(['signature_voucher', id], program);

/** CreateCouncil: the dWallet's current owner fixes the members and the quorum. */
export function createCouncil(a: {
	program: PublicKey;
	ikaProgram: PublicKey;
	dwallet: PublicKey;
	owner: PublicKey;
	members: PublicKey[];
	quorum: number;
}): TransactionInstruction {
	const data = Buffer.alloc(1 + 4 + 2 + 32 * a.members.length);
	data[0] = 2;
	data.writeUInt32LE(a.quorum, 1);
	data.writeUInt16LE(a.members.length, 5);
	a.members.forEach((member, i) => member.toBuffer().copy(data, 7 + 32 * i));
	return new TransactionInstruction({
		programId: a.program,
		keys: [
			{ pubkey: councilAddress(a.program, a.dwallet)[0], isSigner: false, isWritable: true },
			{ pubkey: a.dwallet, isSigner: false, isWritable: false },
			{ pubkey: a.ikaProgram, isSigner: false, isWritable: false },
			{ pubkey: a.owner, isSigner: true, isWritable: false },
			{ pubkey: a.owner, isSigner: true, isWritable: true }, // pays the rent
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data,
	});
}

/** CreateProposal: a member proposes a message digest for the council's dWallet. */
export function createProposal(a: {
	program: PublicKey;
	dwallet: PublicKey;
	proposer: PublicKey;
	payer: PublicKey;
	id: Uint8Array;
	messageDigest: Uint8Array;
	requestKey: Uint8Array; // the only key allowed to ask the network to sign
	signatureScheme: number;
}): TransactionInstruction {
	const [proposal, proposalBump] = proposalAddress(a.program, a.id);
	const [, voucherBump] = voucherAddress(a.program, a.id);
	const data = Buffer.alloc(1 + 100);
	data[0] = 0;
	Buffer.from(a.id).copy(data, 1);
	Buffer.from(a.messageDigest).copy(data, 33);
	Buffer.from(a.requestKey).copy(data, 65);
	data.writeUInt16LE(a.signatureScheme, 97);
	data[99] = voucherBump;
	data[100] = proposalBump;
	return new TransactionInstruction({
		programId: a.program,
		keys: [
			{ pubkey: proposal, isSigner: false, isWritable: true },
			{ pubkey: councilAddress(a.program, a.dwallet)[0], isSigner: false, isWritable: false },
			{ pubkey: a.dwallet, isSigner: false, isWritable: false },
			{ pubkey: a.proposer, isSigner: true, isWritable: false },
			{ pubkey: a.payer, isSigner: true, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data,
	});
}

/**
 * CastVote: a member votes yes. The vote that reaches the quorum also issues
 * the voucher, so it carries the accounts of the CPI to the ika program.
 */
export function castVote(a: {
	program: PublicKey;
	ikaProgram: PublicKey;
	coordinator: PublicKey;
	dwallet: PublicKey;
	voter: PublicKey;
	payer: PublicKey;
	id: Uint8Array;
	reachesQuorum: boolean;
}): TransactionInstruction {
	const [voteRecord, voteBump] = voteAddress(a.program, a.id, a.voter);
	const [authority, authorityBump] = cpiAuthority(a.program);
	const data = Buffer.alloc(1 + 35);
	data[0] = 1;
	Buffer.from(a.id).copy(data, 1);
	data[33] = 1; // yes
	data[34] = voteBump;
	data[35] = authorityBump;
	const keys = [
		{ pubkey: proposalAddress(a.program, a.id)[0], isSigner: false, isWritable: true },
		{ pubkey: voteRecord, isSigner: false, isWritable: true },
		{ pubkey: councilAddress(a.program, a.dwallet)[0], isSigner: false, isWritable: false },
		{ pubkey: a.voter, isSigner: true, isWritable: false },
		{ pubkey: a.payer, isSigner: true, isWritable: true },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
	];
	if (a.reachesQuorum) {
		keys.push(
			{ pubkey: a.coordinator, isSigner: false, isWritable: false },
			{ pubkey: voucherAddress(a.program, a.id)[0], isSigner: false, isWritable: true },
			{ pubkey: a.dwallet, isSigner: false, isWritable: false },
			{ pubkey: a.program, isSigner: false, isWritable: false },
			{ pubkey: authority, isSigner: false, isWritable: false },
			{ pubkey: a.ikaProgram, isSigner: false, isWritable: false },
		);
	}
	return new TransactionInstruction({ programId: a.program, keys, data });
}
