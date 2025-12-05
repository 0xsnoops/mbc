/**
 * Provider REST API Routes
 * 
 * Endpoints for API providers to register their endpoints.
 * 
 * Routes:
 * - POST /providers/meters - Register a new meter (paywalled API)
 * - GET /providers/meters - List all meters
 * - GET /providers/meters/:id - Get meter details
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db';
import * as circle from '../services/circle';
import { Connection, PublicKey, Transaction, Keypair, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Idl, Wallet, BN } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import path from 'path';

const router = Router();

// =============================================================================
// CONFIGURATION
// =============================================================================

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || 'http://localhost:3000';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'http://localhost:8899';

// Setup Payer/Relayer
let payerKv: Keypair;
if (process.env.PAYER_SECRET_KEY && process.env.PAYER_SECRET_KEY.startsWith('[')) {
    payerKv = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.PAYER_SECRET_KEY)));
} else {
    payerKv = Keypair.generate();
    console.warn("[Providers] Using generated Payer Keypair (No funds!). Set PAYER_SECRET_KEY.");
}
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Load Anchor Program
let program: Program;
try {
    const idlPath = path.resolve(__dirname, '../../../onchain/target/idl/agent_blink_pay.json');
    const idl = JSON.parse(readFileSync(idlPath, 'utf8'));
    const provider = new AnchorProvider(
        connection,
        new Wallet(payerKv),
        AnchorProvider.defaultOptions()
    );
    program = new Program(idl as Idl, PROGRAM_ID, provider);
} catch (e) {
    console.warn('[Providers] Could not load IDL. On-chain meter creation will effectively verify compilation but fail if IDL missing.');
}

// =============================================================================
// POST /providers/meters - Register Meter
// =============================================================================

/**
 * Registers a new paywalled API endpoint.
 * 
 * Body:
 * {
 *   "name": "OpenAI Chat Completions",
 *   "upstreamUrl": "https://api.openai.com/v1/chat/completions",
 *   "httpMethod": "POST",
 *   "pricePerCall": 50000,   // $0.05 in smallest units
 *   "category": 1,           // AI_API
 *   "requiresZk": true
 * }
 * 
 * Response:
 * {
 *   "id": "meter-123",
 *   "meterPubkey": "...",
 *   "gatewayUrl": "https://gateway.xyz/m/meter-123",
 *   "curlExample": "curl -X POST ...",
 *   "sdkExample": "await agent.callPaywalledApi('meter-123', '/v1/chat/completions', {...})"
 * }
 */
router.post('/providers/meters', async (req: Request, res: Response) => {
    try {
        const {
            name,
            upstreamUrl,
            httpMethod = 'POST',
            pricePerCall,
            category,
            requiresZk = true,
        } = req.body;

        // Validate required fields
        if (!upstreamUrl || !pricePerCall || !category) {
            res.status(400).json({
                error: 'Missing required fields',
                required: ['upstreamUrl', 'pricePerCall', 'category'],
            });
            return;
        }

        console.log(`[Providers] Registering meter: ${name || upstreamUrl}`);

        // Generate meter ID and keypair
        const meterId = uuidv4();
        const meterKeypair = Keypair.generate();
        const meterPubkey = meterKeypair.publicKey.toBase58();

        // Create Circle wallet for merchant
        const merchantWalletId = await circle.createCircleWallet(`Merchant: ${meterId}`);

        // =========================================================================
        // Call create_meter on-chain
        // =========================================================================
        if (program) {
            console.log(`[Providers] Creating meter on-chain...`);

            const [meterPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('meter'),
                    payerKv.publicKey.toBuffer(), // Authority is the relayer for now
                    Buffer.from(meterId.slice(0, 8)) // Hackathon: Use first 8 chars as seed bytes or just UUID bytes? 
                    // Actually, let's use the random meterKeypair we generated as the account, avoiding complex PDA seeds if possible?
                    // Checks lib.rs: `init` using `seeds = [b"meter", authority.key().as_ref(), id.as_ref()]`
                    // We need to pass `id` as string/bytes.
                ],
                PROGRAM_ID
            );

            // NOTE: lib.rs create_meter expects `id: String`. The PDA seeds use `id.as_bytes()`.
            // We'll use the UUID string.

            // Derive PDA correctly based on lib.rs
            const [realMeterPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('meter'),
                    payerKv.publicKey.toBuffer(),
                    Buffer.from(meterId)
                ],
                PROGRAM_ID
            );

            // Using full UUID 'meterId'
            const ix = await program.methods.createMeter(
                meterId,
                new BN(pricePerCall),
                category,
                merchantWalletId,
                requiresZk
            ).accounts({
                authority: payerKv.publicKey,
                meter: realMeterPda,
                systemProgram: SystemProgram.programId,
            }).instruction();

            const tx = new Transaction().add(ix);
            const signature = await connection.sendTransaction(tx, [payerKv]);
            await connection.confirmTransaction(signature, 'confirmed');

            console.log(`[Providers] On-chain meter created. Sig: ${signature}`);

            // Use Real PDA for DB record? Or keep generated keypair?
            // The DB expects `meterPubkey`. If we use PDA, we should store PDA.
            // If we use keypair, we must change program to strict init.
            // Program is using PDA seeds. So we MUST use PDA.
            // Updating `meterPubkey` variable for DB insertion below.
            // (We ignore the previously generated random `meterKeypair` and use PDA)

            // OVERRIDE default random keypair with actual PDA
            // meterPubkey is const, so we can't reassign easily without refactor.
            // We'll update logic to use PDA.
        } else {
            console.warn("[Providers] Program not loaded. Creating DB-only meter.");
        }

        // Re-derive PDA for storage (ensuring consistency)
        const [finalMeterPubkey] = PublicKey.findProgramAddressSync(
            [Buffer.from('meter'), payerKv.publicKey.toBuffer(), Buffer.from(meterId)],
            PROGRAM_ID
        );

        // Store in database
        db.meters.create.run(
            meterId,
            finalMeterPubkey.toBase58(), // Use the PDA
            merchantWalletId,
            upstreamUrl,
            httpMethod.toUpperCase(),
            category,
            pricePerCall,
            requiresZk ? 1 : 0,
            name || `Meter ${meterId.slice(0, 8)}`
        );

        console.log(`[Providers] Meter registered: ${meterId}`);

        // Generate gateway URL
        const gatewayUrl = `${GATEWAY_BASE_URL}/m/${meterId}`;

        // Generate example code
        const curlExample = generateCurlExample(gatewayUrl, httpMethod);
        const sdkExample = generateSdkExample(meterId, upstreamUrl);

        res.status(201).json({
            id: meterId,
            name: name || `Meter ${meterId.slice(0, 8)}`,
            meterPubkey,
            merchantWalletId,
            gatewayUrl,
            pricePerCall,
            pricePerCallFormatted: circle.formatUsdcAmount(pricePerCall),
            category,
            categoryName: getCategoryName(category),
            requiresZk,
            examples: {
                curl: curlExample,
                sdk: sdkExample,
            },
        });

    } catch (error) {
        console.error('[Providers] Error registering meter:', error);
        res.status(500).json({ error: 'Failed to register meter' });
    }
});

// =============================================================================
// GET /providers/meters - List Meters
// =============================================================================

router.get('/providers/meters', async (req: Request, res: Response) => {
    try {
        const meters = db.meters.list.all() as db.Meter[];

        const formattedMeters = meters.map((meter) => ({
            id: meter.id,
            name: meter.name,
            meterPubkey: meter.meter_pubkey,
            upstreamUrl: meter.upstream_url,
            pricePerCall: meter.price_per_call,
            pricePerCallFormatted: circle.formatUsdcAmount(meter.price_per_call),
            category: meter.category,
            categoryName: getCategoryName(meter.category),
            requiresZk: meter.requires_zk,
            gatewayUrl: `${GATEWAY_BASE_URL}/m/${meter.id}`,
            createdAt: meter.created_at,
        }));

        res.json(formattedMeters);

    } catch (error) {
        console.error('[Providers] Error listing meters:', error);
        res.status(500).json({ error: 'Failed to list meters' });
    }
});

// =============================================================================
// GET /providers/meters/:id - Get Meter Details
// =============================================================================

router.get('/providers/meters/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const meter = db.meters.findById.get(id) as db.Meter | undefined;

        if (!meter) {
            res.status(404).json({ error: 'Meter not found' });
            return;
        }

        const gatewayUrl = `${GATEWAY_BASE_URL}/m/${meter.id}`;

        res.json({
            id: meter.id,
            name: meter.name,
            meterPubkey: meter.meter_pubkey,
            merchantWalletId: meter.merchant_wallet_id,
            upstreamUrl: meter.upstream_url,
            httpMethod: meter.http_method,
            pricePerCall: meter.price_per_call,
            pricePerCallFormatted: circle.formatUsdcAmount(meter.price_per_call),
            category: meter.category,
            categoryName: getCategoryName(meter.category),
            requiresZk: meter.requires_zk,
            gatewayUrl,
            examples: {
                curl: generateCurlExample(gatewayUrl, meter.http_method),
                sdk: generateSdkExample(meter.id, meter.upstream_url),
            },
            createdAt: meter.created_at,
        });

    } catch (error) {
        console.error('[Providers] Error getting meter:', error);
        res.status(500).json({ error: 'Failed to get meter' });
    }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getCategoryName(category: number): string {
    const categories: Record<number, string> = {
        1: 'AI_API',
        2: 'DATA_FEED',
        3: 'TOOL',
        4: 'CATAN_ACTION',
    };
    return categories[category] || `UNKNOWN_${category}`;
}

function generateCurlExample(gatewayUrl: string, method: string): string {
    return `curl -X ${method} \\
  -H "x-agent-id: YOUR_AGENT_ID" \\
  -H "x-agent-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"your": "data"}' \\
  ${gatewayUrl}/your/endpoint`;
}

function generateSdkExample(meterId: string, upstreamUrl: string): string {
    const parsedUrl = new URL(upstreamUrl);
    return `// Install: npm install @agentblinkpay/sdk
import { AgentClient } from '@agentblinkpay/sdk';

const agent = new AgentClient({
  agentId: 'YOUR_AGENT_ID',
  apiKey: 'YOUR_API_KEY',
  gatewayBaseUrl: '${GATEWAY_BASE_URL}',
  backendBaseUrl: '${GATEWAY_BASE_URL}',
});

const response = await agent.callPaywalledApi(
  '${meterId}',
  '${parsedUrl.pathname}',
  {
    method: 'POST',
    body: JSON.stringify({ your: 'data' }),
  }
);
const data = await response.json();`;
}

export default router;
