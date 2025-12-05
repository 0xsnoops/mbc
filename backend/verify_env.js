const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');

try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const hasPayer = envContent.includes('PAYER_SECRET_KEY=[');
    const hasCircle = envContent.includes('CIRCLE_USDC_TOKEN_ID=4zMMC');

    console.log('Environment Check:');
    console.log(`PAYER_SECRET_KEY present: ${hasPayer}`);
    console.log(`CIRCLE_USDC_TOKEN_ID present: ${hasCircle}`);
} catch (err) {
    console.error('Error reading .env:', err.message);
}
