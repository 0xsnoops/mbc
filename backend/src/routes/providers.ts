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
import { Keypair, PublicKey } from '@solana/web3.js';
import * as db from '../db';
import * as circle from '../services/circle';

const router = Router();

// =============================================================================
// CONFIGURATION
// =============================================================================

const PROGRAM_ID = process.env.PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || 'http://localhost:3000';

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
        // TODO: Call create_meter on-chain
        // =========================================================================
        // 
        // const connection = new Connection(SOLANA_RPC_URL);
        // 
        // const meterPda = PublicKey.findProgramAddressSync(
        //   [
        //     Buffer.from('meter'),
        //     authorityPubkey.toBuffer(),
        //     meterIdBuffer,
        //   ],
        //   PROGRAM_ID
        // )[0];
        // 
        // const ix = program.methods.createMeter(
        //   new BN(pricePerCall),
        //   category,
        //   merchantWalletId,
        //   requiresZk
        // ).accounts({
        //   authority: authorityPubkey,
        //   meterId: meterIdAccount,
        //   meter: meterPda,
        //   systemProgram: SystemProgram.programId,
        // }).instruction();
        // 
        // const tx = new Transaction().add(ix);
        // await connection.sendTransaction(tx, [authority]);
        // =========================================================================

        // Store in database
        db.meters.create.run(
            meterId,
            meterPubkey,
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
