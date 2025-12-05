const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const kp = Keypair.generate();
const secretKey = JSON.stringify(Array.from(kp.secretKey));

console.log('Public Key:', kp.publicKey.toBase58());
fs.writeFileSync(path.join(__dirname, 'key.json'), secretKey);
console.log('Secret key written to backend/key.json');
