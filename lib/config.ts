// The ika devnet pre-alpha, and the other networks the workshop talks to.
//
// The ika values come from the pre-alpha's docs ("The devnet pre-alpha").
// They are recorded on Solana, in the ika program's dWallet coordinator
// account. If the pre-alpha is reset, update them here.

import { homedir } from 'node:os';
import { join } from 'node:path';

export const IKA = {
	/** The ika program on Solana devnet. */
	programId: '8siGnE3tCZbu4LTuX8QoBPErvWeGBF4pRSJDnaGdHyQv',
	/** The ika network, over gRPC-Web. */
	grpcUrl: 'https://solana-alpha-dev-1.ika-network.net',
	/** The network key every answer of the network is checked against. */
	networkKey: 'fe8a6482521cc4bae052c55cd5b3c92d05c8749bcc2c584046de3efb077d65ed',
	chainNumber: 1,
	networkValue: 3,
};

/** The voting program from the ika-pre-alpha examples, deployed on devnet. */
export const VOTING_PROGRAM_ID =
	process.env.VOTING_PROGRAM_ID ?? 'KUT45QX6M9QEixegexSexvUg5aX7LnWXfDNhppedrHG';

/** Solana devnet. The public endpoint is rate-limited: set RPC_URL to your own. */
export const SOLANA_RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';

/** Your Solana devnet keypair: it pays for transactions and owns the dWallet. */
export const KEYPAIR_PATH = process.env.KEYPAIR ?? join(homedir(), '.config', 'solana', 'id.json');

/** An Ethereum Sepolia RPC, for the nonce, the fees and the broadcast. */
export const SEPOLIA_RPC_URL =
	process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

/** A Bitcoin signet Esplora API, for the coins and the broadcast. */
export const SIGNET_API_URL = process.env.SIGNET_API_URL ?? 'https://mempool.space/signet/api';

/** Where the workshop keeps your root seed and your dWallet between steps. */
export const STATE_DIR = '.workshop';
