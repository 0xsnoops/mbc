require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Keypair } = require('@solana/web3.js');

try {
    const secretKeyString = process.env.PAYER_SECRET_KEY;
    if (!secretKeyString) {
        throw new Error('PAYER_SECRET_KEY not found in .env');
    }
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const keypair = Keypair.fromSecretKey(secretKey);

    console.log('\n=== Relayer Wallet Info ===');
    console.log(`Public Key: ${keypair.publicKey.toBase58()}`);
    console.log('Action: Fund this address with SOL on Devnet:');
    console.log(`Command: solana airdrop 2 ${keypair.publicKey.toBase58()} --url devnet`);
    console.log('===========================\n');
} catch (error) {
    console.error('Error reading key:', error.message);
}
