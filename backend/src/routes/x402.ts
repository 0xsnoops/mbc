/**
 * x402 HTTP Gateway Routes
 * 
 * Implements the x402 payment protocol for paywalled API endpoints.
 * 
 * Flow:
 * 1. Agent requests /m/:meterId/path/to/resource
 * 2. Gateway checks for valid credit
 * 3. If no credit: return 402 with payment metadata
 * 4. If credit exists: consume credit and proxy to upstream
 * 
 * x402 Response Format:
 * {
 *   "type": "x402",
 *   "meterId": "meter-123",
 *   "amount": 50000,
 *   "category": 1,
 *   "paymentInstructions": {
 *     "meterPubkey": "...",
 *     "programId": "...",
 *     "network": "solana"
 *   }
 * }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Connection } from '@solana/web3.js';
import { createProxyMiddleware, Options as ProxyOptions } from 'http-proxy-middleware';
import * as db from '../db';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// =============================================================================
// CONFIGURATION
// =============================================================================

const PROGRAM_ID = process.env.PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'http://localhost:8899';
const NETWORK = process.env.SOLANA_NETWORK || 'devnet';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface X402Response {
    type: 'x402';
    meterId: string;
    amount: number;
    category: number;
    paymentInstructions: {
        meterPubkey: string;
        programId: string;
        network: string;
        // Extended Fields for "Real" Transaction Construction
        nonce: string;        // 64-bit unique nonce
        expiresAt: number;    // Slot expiry
        policyHash?: string;  // Hash commitment (optional, client might derive or fetch)
    };
}

// =============================================================================
// MIDDLEWARE: AGENT AUTHENTICATION
// =============================================================================

/**
 * Authenticates agent via x-agent-id and x-agent-api-key headers.
 */
function authenticateAgent(req: Request, res: Response, next: NextFunction): void {
    const agentId = req.headers['x-agent-id'] as string;
    const apiKey = req.headers['x-agent-api-key'] as string;

    if (!agentId || !apiKey) {
        res.status(401).json({
            error: 'Missing authentication headers',
            required: ['x-agent-id', 'x-agent-api-key'],
        });
        return;
    }

    // Verify agent and API key
    const agent = db.agents.findById.get(agentId) as db.Agent | undefined;

    if (!agent) {
        res.status(401).json({ error: 'Unknown agent' });
        return;
    }

    if (agent.api_key !== apiKey) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
    }

    if (agent.frozen) {
        res.status(403).json({ error: 'Agent is frozen' });
        return;
    }

    // Attach agent to request
    (req as any).agent = agent;
    next();
}

// =============================================================================
// MAIN GATEWAY ROUTE
// =============================================================================

/**
 * x402 Gateway Route
 * 
 * ALL /m/:meterId/* - Handles all methods and paths for a meter
 * 
 * Header Requirements:
 * - x-agent-id: The agent's ID
 * - x-agent-api-key: The agent's API key
 * 
 * Response:
 * - 402 Payment Required: If no credit exists (includes x402 metadata)
 * - 200/etc: Proxied response from upstream API if credit exists
 */
router.all('/m/:meterId/*', authenticateAgent, async (req: Request, res: Response) => {
    const { meterId } = req.params;
    const agent = (req as any).agent as db.Agent;

    console.log(`[x402] Request: ${req.method} /m/${meterId}${req.path.slice(meterId.length + 3)}`);
    console.log(`[x402] Agent: ${agent.id}`);

    // Look up meter
    const meter = db.meters.findById.get(meterId) as db.Meter | undefined;

    if (!meter) {
        res.status(404).json({ error: 'Meter not found' });
        return;
    }

    // Check for available credit
    const credit = db.credits.findAvailable.get(agent.id, meter.id) as db.Credit | undefined;

    if (!credit) {
        // No credit - return 402 with payment metadata
        console.log(`[x402] No credit available, returning 402`);

        const x402Response: X402Response = {
            type: 'x402',
            meterId: meter.id,
            amount: meter.price_per_call,
            category: meter.category,
            paymentInstructions: {
                meterPubkey: meter.meter_pubkey,
                programId: PROGRAM_ID,
                network: NETWORK,
                nonce: Date.now().toString(),
                expiresAt: (await getCurrentSlot()) + 150, // Valid for ~1 min
            },
        };

        // Standard x402 Header
        res.setHeader('WWW-Authenticate', `Token realm="AgentBlinkPay", error="insufficient_credits", meter_id="${meter.id}", amount=${meter.price_per_call}`);
        res.status(402).json(x402Response);
        return;
    }

    // Credit exists - consume it and proxy to upstream
    console.log(`[x402] Credit found: ${credit.id}, proxying to upstream`);

    // Mark credit as used
    db.credits.markUsed.run(credit.id);

    // Proxy to upstream API
    await proxyToUpstream(req, res, meter);
});

// =============================================================================
// UPSTREAM PROXY
// =============================================================================

/**
 * Proxies the request to the upstream API.
 * 
 * Strips our internal headers and forwards the request.
 */
async function proxyToUpstream(req: Request, res: Response, meter: db.Meter): Promise<void> {
    const upstreamUrl = new URL(meter.upstream_url);

    // Extract the path after /m/:meterId/
    const meterId = req.params.meterId;
    const targetPath = req.originalUrl.slice(`/m/${meterId}`.length);

    const fullUrl = `${upstreamUrl.origin}${upstreamUrl.pathname}${targetPath}`;

    console.log(`[x402] Proxying to: ${fullUrl}`);

    try {
        // Make request to upstream
        const axios = (await import('axios')).default;

        // Prepare headers (remove internal ones)
        const headers = { ...req.headers };
        delete headers['x-agent-id'];
        delete headers['x-agent-api-key'];
        delete headers['host'];

        const response = await axios({
            method: req.method as any,
            url: fullUrl,
            headers,
            data: req.body,
            validateStatus: () => true, // Don't throw on any status
        });

        // Forward response
        res.status(response.status);
        Object.entries(response.headers).forEach(([key, value]) => {
            if (value && typeof value === 'string') {
                res.setHeader(key, value);
            }
        });
        res.send(response.data);

    } catch (error) {
        console.error(`[x402] Proxy error:`, error);
        res.status(502).json({ error: 'Upstream request failed' });
    }
}

// =============================================================================
// CREDIT CHECK ENDPOINT (for debugging/SDK)
// =============================================================================

/**
 * GET /m/:meterId/credit-status
 * 
 * Returns whether the agent has available credit for this meter.
 */
router.get('/m/:meterId/credit-status', authenticateAgent, (req: Request, res: Response) => {
    const { meterId } = req.params;
    const agent = (req as any).agent as db.Agent;

    const meter = db.meters.findById.get(meterId) as db.Meter | undefined;
    if (!meter) {
        res.status(404).json({ error: 'Meter not found' });
        return;
    }

    const credit = db.credits.findAvailable.get(agent.id, meter.id) as db.Credit | undefined;

    res.json({
        hasCredit: !!credit,
        meterId,
        pricePerCall: meter.price_per_call,
        category: meter.category,
    });
});

async function getCurrentSlot(): Promise<number> {
    try {
        const connection = new Connection(SOLANA_RPC_URL);
        return await connection.getSlot();
    } catch {
        return 0;
    }
}

export default router;
