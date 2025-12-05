/**
 * Agent REST API Routes
 * 
 * Endpoints for agent management and payment operations.
 * 
 * Routes:
 * - POST /agents - Create a new agent
 * - GET /agents/:id - Get agent status
 * - POST /agents/:id/pay - Trigger ZK proof + payment
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import * as db from '../db';
import * as circle from '../services/circle';
import { Connection, PublicKey, Transaction, Keypair, SystemProgram } from '@solana/web3.js';

const router = Router();

// =============================================================================
// CONFIGURATION
// =============================================================================

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'http://localhost:8899';

// =============================================================================
// POST /agents - Create Agent
// =============================================================================

/**
 * Creates a new agent.
 * 
 * Body:
 * {
 *   "name": "My Agent",
 *   "allowedCategory": 1,
 *   "maxPerTx": 1000000
 * }
 * 
 * Response:
 * {
 *   "id": "agent-123",
 *   "agentPubkey": "...",
 *   "circleWalletId": "wallet_...",
 *   "apiKey": "ak_...",
 *   "name": "My Agent"
 * }
 */
router.post('/agents', async (req: Request, res: Response) => {
    try {
        const { name, allowedCategory = 1, maxPerTx = 1000000 } = req.body;

        console.log(`[Agents] Creating agent: ${name}`);

        // Generate agent ID and keypair
        const agentId = uuidv4();
        const agentKeypair = Keypair.generate();
        const agentPubkey = agentKeypair.publicKey.toBase58();

        // Create Circle wallet
        const circleWalletId = await circle.createCircleWallet(`Agent: ${agentId}`);

        // Generate API key
        const apiKey = `ak_${crypto.randomBytes(32).toString('hex')}`;

        // Store in database
        db.agents.create.run(
            agentId,
            agentPubkey,
            circleWalletId,
            apiKey,
            name || `Agent ${agentId.slice(0, 8)}`
        );

        // =========================================================================
        // TODO: Call set_policy on-chain to create AgentPolicy account
        // =========================================================================
        // 
        // In production, we would:
        // 1. Build set_policy instruction with policy parameters
        // 2. Sign and submit transaction
        // 3. Wait for confirmation
        // 
        // const connection = new Connection(SOLANA_RPC_URL);
        // const policyPda = PublicKey.findProgramAddressSync(
        //   [Buffer.from('policy'), agentKeypair.publicKey.toBuffer()],
        //   PROGRAM_ID
        // )[0];
        // 
        // const ix = program.methods.setPolicy(
        //   policyHash,
        //   allowedCategory,
        //   new BN(maxPerTx),
        //   false
        // ).accounts({...}).instruction();
        // 
        // const tx = new Transaction().add(ix);
        // await connection.sendTransaction(tx, [payer, agentKeypair]);
        // =========================================================================

        console.log(`[Agents] Agent created: ${agentId}`);

        res.status(201).json({
            id: agentId,
            agentPubkey,
            circleWalletId,
            apiKey,
            name: name || `Agent ${agentId.slice(0, 8)}`,
            message: 'Agent created successfully. Store the API key securely.',
        });

    } catch (error) {
        console.error('[Agents] Error creating agent:', error);
        res.status(500).json({ error: 'Failed to create agent' });
    }
});

// =============================================================================
// GET /agents/:id - Get Agent Status
// =============================================================================

/**
 * Gets agent status including balance and recent spend.
 * 
 * Response:
 * {
 *   "id": "agent-123",
 *   "name": "My Agent",
 *   "agentPubkey": "...",
 *   "circleBalance": "100.50",
 *   "recentSpend": "25.00",
 *   "frozen": false
 * }
 */
router.get('/agents/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const agent = db.agents.findById.get(id) as db.Agent | undefined;

        if (!agent) {
            res.status(404).json({ error: 'Agent not found' });
            return;
        }

        // Get Circle wallet balance
        const circleBalance = await circle.getWalletBalance(agent.circle_wallet_id);

        // Calculate recent spend (last 24h)
        const recentPayments = db.payments.findByAgent.all(id, 100) as db.Payment[];
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recentSpend = recentPayments
            .filter(p => p.created_at >= oneDayAgo && p.status === 'succeeded')
            .reduce((sum, p) => sum + p.amount, 0);

        res.json({
            id: agent.id,
            name: agent.name,
            agentPubkey: agent.agent_pubkey,
            circleWalletId: agent.circle_wallet_id,
            circleBalance,
            recentSpend: circle.formatUsdcAmount(recentSpend),
            recentPayments: recentPayments.map(p => ({
                id: p.id,
                meterId: p.meter_id,
                amount: p.amount,
                amountFormatted: circle.formatUsdcAmount(p.amount),
                status: p.status,
                createdAt: p.created_at,
            })),
            frozen: agent.frozen,
            createdAt: agent.created_at,
        });

    } catch (error) {
        console.error('[Agents] Error getting agent:', error);
        res.status(500).json({ error: 'Failed to get agent' });
    }
});

// =============================================================================
// GET /agents - List All Agents
// =============================================================================

router.get('/agents', async (req: Request, res: Response) => {
    try {
        const agents = db.agents.list.all() as db.Agent[];

        const agentsWithBalance = await Promise.all(
            agents.map(async (agent) => {
                const balance = await circle.getWalletBalance(agent.circle_wallet_id);
                return {
                    id: agent.id,
                    name: agent.name,
                    agentPubkey: agent.agent_pubkey,
                    circleBalance: balance,
                    frozen: agent.frozen,
                    createdAt: agent.created_at,
                };
            })
        );

        res.json(agentsWithBalance);

    } catch (error) {
        console.error('[Agents] Error listing agents:', error);
        res.status(500).json({ error: 'Failed to list agents' });
    }
});

// =============================================================================
// POST /agents/:id/pay - Trigger Payment
// =============================================================================

/**
 * Triggers a payment flow for an agent.
 * 
 * Called by the SDK when a 402 response is received.
 * 
 * Body:
 * {
 *   "meterId": "meter-123",
 *   "amount": 50000,
 *   "category": 1,
 *   "meterPubkey": "..."
 * }
 * 
 * Flow:
 * 1. Fetch agent policy and meter details
 * 2. Generate ZK proof (stubbed)
 * 3. Build and submit authorize_payment_with_proof tx
 * 4. Build and submit record_meter_payment tx
 * 5. Return success (listener will handle Circle transfer)
 */
router.post('/agents/:id/pay', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { meterId, amount, category, meterPubkey } = req.body;

        console.log(`[Agents] Payment request: agent=${id}, meter=${meterId}, amount=${amount}`);

        // Validate agent
        const agent = db.agents.findById.get(id) as db.Agent | undefined;
        if (!agent) {
            res.status(404).json({ error: 'Agent not found' });
            return;
        }

        if (agent.frozen) {
            res.status(403).json({ error: 'Agent is frozen' });
            return;
        }

        // Authentication: Verify API Key
        const apiKey = req.headers['x-agent-api-key'] as string;
        if (!apiKey || apiKey !== agent.api_key) {
            console.warn(`[Agents] Unauthorized payment attempt for agent ${id}`);
            res.status(401).json({ error: 'Invalid API Key' });
            return;
        }

        // Validate meter
        const meter = db.meters.findById.get(meterId) as db.Meter | undefined;
        if (!meter) {
            res.status(404).json({ error: 'Meter not found' });
            return;
        }

        // Generate secure 64-bit nonce
        // distinct from Date.now() to prevent predictable replay attacks
        const nonce = crypto.randomBytes(8).readBigUInt64LE(0);

        // Expiry: Current slot + 150 (approx 60 seconds)
        const currentSlot = await getCurrentSlot();
        const expiresAtSlot = currentSlot + 150;

        // =========================================================================
        // STEP 1: Generate ZK Proof (Stubbed)
        // =========================================================================
        // 
        // In production, use Noir WASM prover:
        // 
        // import { Noir } from '@noir-lang/noir_js';
        // 
        // const circuit = await Noir.compile('payment_policy');
        // const proof = await circuit.generateProof({
        //   amount: BigInt(amount),
        //   category: BigInt(category),
        //   policy_hash: policyHash,
        //   max_per_tx: BigInt(maxPerTx),     // from agent policy
        //   allowed_category: BigInt(allowedCategory),
        //   policy_salt: policySalt,
        // });
        // =========================================================================
        const proof = generateStubProof(amount, category);

        console.log(`[Agents] Generated proof (${proof.length} bytes)`);

        // =========================================================================
        // STEP 2: Submit authorize_payment_with_proof Transaction
        // =========================================================================
        // 
        // const connection = new Connection(SOLANA_RPC_URL);
        // 
        // const authPda = PublicKey.findProgramAddressSync(
        //   [
        //     Buffer.from('auth'),
        //     new PublicKey(agent.agent_pubkey).toBuffer(),
        //     new PublicKey(meterPubkey).toBuffer(),
        //     new BN(nonce).toArrayLike(Buffer, 'le', 8),
        //   ],
        //   PROGRAM_ID
        // )[0];
        // 
        // const authIx = program.methods.authorizePaymentWithProof(
        //   new BN(amount),
        //   category,
        //   new BN(nonce),
        //   new BN(expiresAtSlot),
        //   proof
        // ).accounts({
        //   agent: new PublicKey(agent.agent_pubkey),
        //   agentPolicy: policyPda,
        //   meter: new PublicKey(meterPubkey),
        //   authorization: authPda,
        //   payer: payer.publicKey,
        //   systemProgram: SystemProgram.programId,
        // }).instruction();
        // 
        // const tx1 = new Transaction().add(authIx);
        // await connection.sendTransaction(tx1, [payer, agentKeypair]);
        // =========================================================================

        console.log(`[Agents] Submitting authorize_payment_with_proof (stub)`);

        // =========================================================================
        // STEP 3: Submit record_meter_payment Transaction
        // =========================================================================
        // 
        // const recordIx = program.methods.recordMeterPayment(
        //   new BN(nonce)
        // ).accounts({
        //   agent: new PublicKey(agent.agent_pubkey),
        //   meter: new PublicKey(meterPubkey),
        //   authorization: authPda,
        // }).instruction();
        // 
        // const tx2 = new Transaction().add(recordIx);
        // await connection.sendTransaction(tx2, [payer, agentKeypair]);
        // =========================================================================

        console.log(`[Agents] Submitting record_meter_payment (stub)`);

        // For demo purposes, directly create a credit
        // In production, the event listener handles this
        const paymentId = uuidv4();
        const eventId = circle.generateIdempotencyKey(
            agent.agent_pubkey,
            meter.meter_pubkey,
            nonce
        );

        db.payments.create.run(
            paymentId,
            eventId,
            agent.id,
            meter.id,
            amount,
            nonce,
            category,
            currentSlot,
            agent.circle_wallet_id,
            meter.merchant_wallet_id
        );

        db.payments.updateStatus.run('succeeded', null, 'stub_transfer', paymentId);

        const creditId = uuidv4();
        db.credits.create.run(creditId, agent.id, meter.id, paymentId);

        console.log(`[Agents] Payment completed, credit created: ${creditId}`);

        res.json({
            success: true,
            paymentId,
            creditId,
            nonce: nonce.toString(), // Convert BigInt to string for JSON
            message: 'Payment authorized and recorded. You now have credit for the meter.',
        });

    } catch (error) {
        console.error('[Agents] Error processing payment:', error);
        res.status(500).json({ error: 'Failed to process payment' });
    }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Gets the current Solana slot.
 */
async function getCurrentSlot(): Promise<number> {
    try {
        const connection = new Connection(SOLANA_RPC_URL);
        return await connection.getSlot();
    } catch {
        // Fallback for when Solana is not available
        return Math.floor(Date.now() / 400);
    }
}

/**
 * Generates a stub ZK proof for development.
 * 
 * In production, this would use the Noir prover.
 */
function generateStubProof(amount: number, category: number): Buffer {
    // Create a deterministic fake proof for testing
    const data = `proof:${amount}:${category}:${Date.now()}`;
    return Buffer.from(crypto.createHash('sha256').update(data).digest());
}

export default router;
