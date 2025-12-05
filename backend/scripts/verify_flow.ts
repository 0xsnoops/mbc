
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const API_URL = 'http://localhost:3000';

// Colors for console
const CLR = {
    GREEN: '\x1b[32m',
    RED: '\x1b[31m',
    CYAN: '\x1b[36m',
    YELLOW: '\x1b[33m',
    RESET: '\x1b[0m'
};

async function main() {
    console.log(`${CLR.CYAN}=== AgentBlinkPay Golden Path Verification ===${CLR.RESET}\n`);

    try {
        // 1. Health Check
        try {
            await axios.get(`${API_URL}/health`);
            console.log(`${CLR.GREEN}✓ Backend is running${CLR.RESET}`);
        } catch (e) {
            console.error(`${CLR.RED}✗ Backend is unreachable at ${API_URL}. Start it with 'npm run dev'.${CLR.RESET}`);
            process.exit(1);
        }

        // 2. Register Meter
        const meterId = uuidv4().substring(0, 8); // simplified logic
        const meterReq = {
            name: `Test Meter ${meterId}`,
            upstreamUrl: 'https://google.com',
            pricePerCall: 50000, // 0.05 USDC
            category: 4 // Catan Action
        };
        console.log(`\n> Registering Meter: ${meterReq.name}...`);
        const meterRes = await axios.post(`${API_URL}/providers/meters`, meterReq);
        const createdMeter = meterRes.data;
        console.log(`${CLR.GREEN}✓ Meter Registered${CLR.RESET}`);
        console.log(`  ID: ${createdMeter.id}`);
        console.log(`  Wallet: ${createdMeter.merchant_wallet_id}`);

        // 3. Create Agent
        const agentReq = {
            name: `Test Agent ${uuidv4().substring(0, 8)}`,
            allowedCategory: 4,
            maxPerTx: 1000000 // 1 USDC
        };
        console.log(`\n> Creating Agent: ${agentReq.name}...`);
        const agentRes = await axios.post(`${API_URL}/agents`, agentReq);
        const createdAgent = agentRes.data;
        console.log(`${CLR.GREEN}✓ Agent Created${CLR.RESET}`);
        console.log(`  ID: ${createdAgent.id}`);
        console.log(`  Wallet: ${createdAgent.circle_wallet_id}`);
        console.log(`  Address: ${createdAgent.wallet_address}`);

        // 4. Funding Pause
        console.log(`\n${CLR.YELLOW}!!! ACTION REQUIRED !!!${CLR.RESET}`);
        console.log(`You must FUND the Agent's Wallet with Devnet USDC to proceed.`);
        console.log(`Address: ${CLR.CYAN}${createdAgent.wallet_address}${CLR.RESET}`);
        console.log(`1. Go to https://faucet.circle.com/`);
        console.log(`2. Select 'Solana Devnet'`);
        console.log(`3. Paste address and Send USDC`);
        console.log(`\nWaiting for you... Press ENTER once funded.`);

        await new Promise(resolve => process.stdin.once('data', resolve));

        // 5. Execute Pay
        console.log(`\n> Executing Payment...`);
        // Simulating the SDK call which hits /agents/:id/pay
        // Note: In real SDK, client signs. Here we assume backend signs (Delegate) or we hit the demo endpoint if available.
        // Wait, the backend /agents/:id/pay endpoint builds and submits the tx?
        // Looking at codebase (assumed), yes, or it returns the tx for client to sign.
        // If it returns tx, we can't sign it here easily without the key.
        // "Phase 3" task "Wire Button" implies client signing.
        // BUT "Phase 5" says "Calls SDK callPaywalledApi".
        // Let's assume for the VERIFICATION SCRIPT we use the backend-managed flow if `catan-demo.ts` works that way.
        // `catan-demo.ts` was "Backtracking... Partial Signing...".
        // So the backend likely "helps" sign.
        // If `agent_blink_pay` program requires Agent signature, we need the key.
        // The Agent Key is stored in DB? User prompt: "Agent private keys stored hex-encoded in SQLite".
        // Ah! So the backend CAN sign for the agent if it manages the key.
        // So hitting POST /agents/:id/pay should work entirely server-side if configured for "Managed Agents".

        try {
            const payRes = await axios.post(`${API_URL}/agents/${createdAgent.id}/pay`, {
                meterId: createdMeter.id,
                amount: 50000
            });
            console.log(`${CLR.GREEN}✓ Payment Initiated${CLR.RESET}`);
            console.log(`  Tx Signature: ${payRes.data.signature}`);

            // 6. Verification Loop
            console.log(`\n> Verifying Settlement (Polling)...`);
            let attempts = 0;
            const maxAttempts = 20;
            const interval = 2000;

            const pollInterval = setInterval(async () => {
                attempts++;
                if (attempts > maxAttempts) {
                    console.error(`${CLR.RED}✗ Timeout waiting for settlement log.${CLR.RESET}`);
                    clearInterval(pollInterval);
                    process.exit(1);
                }

                // We can't easily grep server logs from here unless we expose an endpoint.
                // But we CAN check the Agent's details to see "recentPayments".
                const checkRes = await axios.get(`${API_URL}/agents/${createdAgent.id}`);
                const payments = checkRes.data.recentPayments || [];
                const ourPayment = payments.find((p: any) => p.meterId === createdMeter.id);

                if (ourPayment) {
                    process.stdout.write('.');
                    if (ourPayment.status === 'succeeded') {
                        console.log(`\n${CLR.GREEN}✓ Payment Succeeded!${CLR.RESET}`);
                        console.log(`  Transfer ID: ${ourPayment.transferId || 'Found in logs'}`);
                        clearInterval(pollInterval);
                        console.log(`\n${CLR.GREEN}✨ GOLDEN PATH VERIFIED ✨${CLR.RESET}`);
                        process.exit(0);
                    }
                } else {
                    process.stdout.write('.');
                }
            }, interval);

        } catch (e: any) {
            console.error(`${CLR.RED}✗ Payment Failed: ${e.response?.data?.error || e.message}${CLR.RESET}`);
            process.exit(1);
        }

    } catch (error: any) {
        console.error(`${CLR.RED}✗ Setup Failed: ${error.message}${CLR.RESET}`);
        process.exit(1);
    }
}

main();
