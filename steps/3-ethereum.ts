// Step 3: sign an Ethereum transaction with your dWallet.
//
// The flow is the same for any chain:
//
// 1. Build the transaction the other chain expects, unsigned.
// 2. Approve it on Solana: your wallet, the dWallet's owner, issues a
//    signature voucher for exactly these bytes.
// 3. Ask the ika network to sign. It reads the voucher on Solana for itself,
//    and refuses anything the voucher does not allow.
// 4. Put the signature into the transaction, and send it to that chain.
//
// On Ethereum the signed hash is the Keccak-256 of the unsigned transaction,
// so we ask for ECDSA on secp256k1 with Keccak-256 over those bytes.

import { Hash, SignatureAlgorithm } from '@ika.xyz/pre-alpha-solana/web3';
import type { PublicKey } from '@solana/web3.js';
import {
	createPublicClient,
	formatEther,
	http,
	parseEther,
	parseGwei,
	recoverTransactionAddress,
	serializeTransaction,
	toHex,
	type TransactionSerializableEIP1559,
} from 'viem';
import { sepolia } from 'viem/chains';

import { ethereumAddress, splitSignature } from '../lib/chains.ts';
import { SEPOLIA_RPC_URL } from '../lib/config.ts';
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

const wallet = loadWallet();
const keys = await loadKeys();
const dWallet = loadDWallet();
const from = ethereumAddress(dWallet.publicKey);
const to = (process.env.TO as `0x${string}` | undefined) ?? from; // default: send to yourself
const value = parseEther(process.env.AMOUNT ?? '0');

const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });

step('Building an unsigned Ethereum (Sepolia) transaction');
const [nonce, fees, balance] = await Promise.all([
	sepoliaClient.getTransactionCount({ address: from }),
	sepoliaClient
		.estimateFeesPerGas()
		.catch(() => ({ maxFeePerGas: parseGwei('20'), maxPriorityFeePerGas: parseGwei('1') })),
	sepoliaClient.getBalance({ address: from }),
]);
const transaction: TransactionSerializableEIP1559 = {
	type: 'eip1559',
	chainId: sepolia.id,
	nonce,
	to,
	value,
	gas: 21_000n,
	maxFeePerGas: fees.maxFeePerGas,
	maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
};
const unsigned = hexToBytes(serializeTransaction(transaction));
show('From (your dWallet)', from);
show('To', to);
show('Value', `${formatEther(value)} ETH`);
show('Unsigned transaction', `0x${bytesToHex(unsigned)}`);

const scheme = {
	signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
	hashScheme: Hash.KECCAK256,
};

step('Approving it on Solana');
let voucher!: PublicKey;
await send(wallet, keys, async (ikaTx) => {
	voucher = await ikaTx.approveMessage({ dWallet, message: unsigned, ...scheme });
});
done(`Signature voucher ${voucher.toBase58()}`);

step('Asking the ika network to sign');
const signature = await ikaClient.requestSign({
	dWallet,
	signatureVoucherId: voucher,
	message: unsigned,
	...scheme,
	userShareEncryptionKeys: keys,
});
const { recovery, r, s } = splitSignature(signature);
done('Signed');
show('r', toHex(r));
show('s', toHex(s));

step('Putting the signature into the transaction');
const signed = serializeTransaction(transaction, {
	r: toHex(r),
	s: toHex(s),
	yParity: recovery & 1,
});
const sender = await recoverTransactionAddress({
	serializedTransaction: signed as `0x02${string}`,
});
if (sender.toLowerCase() !== from.toLowerCase()) {
	throw new Error(`the signed transaction recovers to ${sender}, not the dWallet's ${from}`);
}
done(`The signature recovers to your dWallet's address, ${sender}`);
show('Signed transaction', signed);

step('Sending it to Sepolia');
const cost = value + 21_000n * fees.maxFeePerGas;
if (balance < cost) {
	console.log(
		`  Your dWallet has ${formatEther(balance)} Sepolia ETH, and this needs about ${formatEther(cost)}.`,
	);
	console.log(`  Fund ${from} from a Sepolia faucet, then run this step again.`);
} else {
	const hash = await sepoliaClient.sendRawTransaction({ serializedTransaction: signed });
	done(`Sent: https://sepolia.etherscan.io/tx/${hash}`);
}

console.log('\nNext: npm run bitcoin\n');
