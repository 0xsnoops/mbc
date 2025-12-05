const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');

const PAYER_SECRET_KEY_VAL = '[188,57,62,153,245,175,172,133,189,218,51,47,245,168,220,152,216,226,7,193,137,243,87,41,75,17,217,223,5,239,153,77,53,68,49,90,212,74,143,229,39,169,92,29,1,90,143,178,208,95,179,56,15,149,255,72,58,3,183,253,177,155,249,212]';
const CIRCLE_USDC_ID_VAL = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

try {
    let content = '';
    if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf8');
    }

    // Split by lines
    let lines = content.split(/\r?\n/);

    // Filter out existing keys
    lines = lines.filter(line => !line.startsWith('PAYER_SECRET_KEY=') && !line.startsWith('CIRCLE_USDC_TOKEN_ID='));

    // Append new keys
    lines.push(`PAYER_SECRET_KEY=${PAYER_SECRET_KEY_VAL}`);
    lines.push(`CIRCLE_USDC_TOKEN_ID=${CIRCLE_USDC_ID_VAL}`);

    // Join back
    const newContent = lines.join('\n');
    fs.writeFileSync(envPath, newContent);

    console.log('Successfully force-updated .env keys.');

} catch (err) {
    console.error('Failed to update .env:', err);
}
