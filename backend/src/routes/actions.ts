/**
 * Solana Actions / Blinks Routes
 * 
 * Implements Solana Actions–compatible endpoints for controlling agents via Blinks.
 * 
 * Actions:
 * - Freeze Agent: Sets frozen=true on the agent's policy
 * - Unfreeze Agent: Sets frozen=false on the agent's policy
 * - Top Up Agent: Transfers USDC to the agent's wallet
 * 
 * @see https://docs.solana.com/developing/programming-model/actions
 */

import { Router, Request, Response } from 'express';
import {
    Connection,
    PublicKey,
    Transaction,
    TransactionInstruction,
    SystemProgram,
    LAMPORTS_PER_SOL,
    Keypair,
} from '@solana/web3.js';
import * as db from '../db';
import { Program, AnchorProvider, Idl, Wallet, BN } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import path from 'path';

const router = Router();

// =============================================================================
// CONFIGURATION
// =============================================================================

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'http://localhost:8899';
const ACTIONS_ICON_URL = process.env.ACTIONS_ICON_URL || 'https://example.com/icon.png';

// USDC Mint (mainnet)
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// =============================================================================
// TYPE DEFINITIONS (Solana Actions Spec)
// =============================================================================

/**
 * Response for GET request - describes the action
 */
interface ActionGetResponse {
    icon: string;
    title: string;
    description: string;
    label: string;
    links?: {
        actions: ActionLink[];
    };
}

interface ActionLink {
    label: string;
    href: string;
    parameters?: ActionParameter[];
}

interface ActionParameter {
    name: string;
    label: string;
    required?: boolean;
}

/**
 * Response for POST request - returns the transaction
 */
interface ActionPostResponse {
    transaction: string; // Base64-encoded serialized transaction
    message?: string;
}

/**
 * Request body for POST
 */
interface ActionPostRequest {
    account: string; // User's public key
}

// =============================================================================
// GET /api/actions/agent - Action Metadata
// =============================================================================

/**
 * Returns Solana Actions metadata for agent control actions.
 * 
 * Query params:
 * - agentId: The agent to act on
 * - action: "freeze" | "unfreeze" | "topup"
 * 
 * Example:
 * GET /api/actions/agent?agentId=abc123&action=freeze
 */
router.get('/api/actions/agent', (req: Request, res: Response) => {
    const { agentId, action } = req.query;

    // Set required headers for Solana Actions
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (!agentId) {
        // Return action selection menu
        const response: ActionGetResponse = {
            icon: ACTIONS_ICON_URL,
            title: 'AgentBlinkPay Controls',
            description: 'Control your AI agents - freeze, unfreeze, or top up their spending accounts.',
            label: 'Select Action',
            links: {
                actions: [
                    {
                        label: 'Freeze Agent',
                        href: `/api/actions/agent?action=freeze&agentId={agentId}`,
                        parameters: [
                            { name: 'agentId', label: 'Agent ID', required: true },
                        ],
                    },
                    {
                        label: 'Unfreeze Agent',
                        href: `/api/actions/agent?action=unfreeze&agentId={agentId}`,
                        parameters: [
                            { name: 'agentId', label: 'Agent ID', required: true },
                        ],
                    },
                    {
                        label: 'Top Up Agent',
                        href: `/api/actions/agent?action=topup&agentId={agentId}&amount={amount}`,
                        parameters: [
                            { name: 'agentId', label: 'Agent ID', required: true },
                            { name: 'amount', label: 'Amount (USDC)', required: true },
                        ],
                    },
                ],
            },
        };

        res.json(response);
        return;
    }

    // Return specific action metadata
    const actionType = action as string || 'freeze';

    let response: ActionGetResponse;

    switch (actionType) {
        case 'freeze':
            response = {
                icon: ACTIONS_ICON_URL,
                title: 'Freeze Agent',
                description: `Freeze agent ${agentId} to stop all payments. The agent will not be able to authorize any new transactions until unfrozen.`,
                label: 'Freeze Now',
            };
            break;

        case 'unfreeze':
            response = {
                icon: ACTIONS_ICON_URL,
                title: 'Unfreeze Agent',
                description: `Unfreeze agent ${agentId} to resume payments. The agent will be able to authorize transactions again.`,
                label: 'Unfreeze Now',
            };
            break;

        case 'topup':
            const amount = req.query.amount as string || '10';
            response = {
                icon: ACTIONS_ICON_URL,
                title: 'Top Up Agent',
                description: `Add ${amount} USDC to agent ${agentId}'s spending account.`,
                label: `Send ${amount} USDC`,
            };
            break;

        default:
            res.status(400).json({ error: 'Invalid action type' });
            return;
    }

    res.json(response);
});

// =============================================================================
// POST /api/actions/agent - Execute Action
// =============================================================================

/**
 * Executes an agent control action.
 * 
 * Body:
 * {
 *   "account": "USER_PUBLIC_KEY"
 * }
 * 
 * Query params:
 * - agentId: The agent to act on
 * - action: "freeze" | "unfreeze" | "topup"
 * - amount: (for topup) Amount of USDC
 * 
 * Returns a base64-encoded Solana transaction for the user to sign.
 */
router.post('/api/actions/agent', async (req: Request, res: Response) => {
    try {
        // Set required headers for Solana Actions
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

        const { account } = req.body as ActionPostRequest;
        const { agentId, action, amount } = req.query;

        if (!account) {
            res.status(400).json({ error: 'Missing account in request body' });
            return;
        }

        if (!agentId) {
            res.status(400).json({ error: 'Missing agentId query parameter' });
            return;
        }

        // Validate user account
        let userPubkey: PublicKey;
        try {
            userPubkey = new PublicKey(account);
        } catch {
            res.status(400).json({ error: 'Invalid account public key' });
            return;
        }

        // Look up agent
        const agent = db.agents.findById.get(agentId as string) as db.Agent | undefined;
        if (!agent) {
            res.status(404).json({ error: 'Agent not found' });
            return;
        }

        const actionType = (action as string) || 'freeze';
        let transaction: Transaction;
        let message: string;

        const connection = new Connection(SOLANA_RPC_URL);

        switch (actionType) {
            case 'freeze':
                transaction = await buildFreezeTx(connection, userPubkey, agent, true);
                message = `Agent ${agentId} will be frozen. No new payments will be authorized.`;
                break;

            case 'unfreeze':
                transaction = await buildFreezeTx(connection, userPubkey, agent, false);
                message = `Agent ${agentId} will be unfrozen. Payments can resume.`;
                break;

            case 'topup':
                const topupAmount = parseFloat(amount as string) || 10;
                transaction = await buildTopupTx(connection, userPubkey, agent, topupAmount);
                message = `${topupAmount} USDC will be sent to agent ${agentId}.`;
                break;

            default:
                res.status(400).json({ error: 'Invalid action type' });
                return;
        }

        // Serialize transaction
        const serialized = transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
        });
        const base64Tx = serialized.toString('base64');

        const response: ActionPostResponse = {
            transaction: base64Tx,
            message,
        };

        res.json(response);

    } catch (error) {
        console.error('[Actions] Error processing action:', error);
        res.status(500).json({ error: 'Failed to process action' });
    }
});

// =============================================================================
// OPTIONS handler for CORS preflight
// =============================================================================

router.options('/api/actions/agent', (req: Request, res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.status(204).end();
});

// =============================================================================
// TRANSACTION BUILDERS
// =============================================================================

/**
 * Builds a transaction to freeze/unfreeze an agent.
 * 
 * This calls set_policy on the AgentBlinkPay program with frozen=true/false.
 */
async function buildFreezeTx(
    connection: Connection,
    userPubkey: PublicKey,
    agent: db.Agent,
    freeze: boolean
): Promise<Transaction> {
    // =========================================================================
    // Build set_policy instruction
    // =========================================================================

    // 1. Recover Agent Keypair
    if (!agent.agent_secret_key) {
        throw new Error("Agent secret key missing. Cannot sign freeze tx.");
    }
    const secretKey = Uint8Array.from(Buffer.from(agent.agent_secret_key, 'hex'));
    const agentKeypair = Keypair.fromSecretKey(secretKey);

    // 2. Load Program
    // Helper to get program instance (duplicated for now)
    const idlPath = path.resolve(__dirname, '../../../onchain/target/idl/agent_blink_pay.json');
    const idl = JSON.parse(readFileSync(idlPath, 'utf8'));
    // We use a dummy provider just to create the Program object
    const provider = new AnchorProvider(
        connection,
        new Wallet(Keypair.generate()),
        AnchorProvider.defaultOptions()
    );
    const program = new Program(idl as Idl, PROGRAM_ID, provider);

    const agentPubkey = new PublicKey(agent.agent_pubkey);

    const [policyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('policy'), agentPubkey.toBuffer()],
        PROGRAM_ID
    );

    // We need existing policy state to preserve other fields?
    // Or we overwrite?
    // The instruction overwrites: `policy.allowed_category = allowed_category;`
    // So we should fetch current state if possible, or use defaults.
    // For this hackathon, let's assume standard defaults if fetching is complex,
    // OR try to fetch account.

    let currentCategory = 1; // Default AI_API
    let currentMaxPerTx = new BN(1000000); // Default 1 USDC
    let currentPolicyHash = [...Buffer.alloc(32)]; // Empty hash

    try {
        const policyAccount = await program.account.agentPolicy.fetchNullable(policyPda);
        if (policyAccount) {
            currentCategory = (policyAccount as any).allowed_category;
            currentMaxPerTx = (policyAccount as any).max_per_tx;
            currentPolicyHash = (policyAccount as any).policy_hash;
        }
    } catch (e) {
        console.log("Could not fetch existing policy, using defaults.");
    }

    // 3. Calculate New Policy Hash (Critical for ZK Integrity)
    // If we don't update the hash, the commitment check `hash(max, category, salt) == policy_hash` will fail
    // unless the ZK proof is also updated. But since we are changing the policy (frozen=true),
    // we MUST update the hash to match the new state (or existing state if just freezing).
    // Wait, `frozen` is NOT part of the hash commitment in lib.rs.
    // Hash = SHA256(max_per_tx | allowed_category | salt)
    // Sce: lib.rs: `hasher.hash(&policy.max_per_tx.to_le_bytes());` ...

    // We are only changing `frozen`. `max_per_tx` and `allowed_category` remain `currentResults`.
    // So the existing `currentPolicyHash` SHOULD still be valid IF it was computed correctly.
    // However, if we blindly pass `currentPolicyHash` back, it works.
    // BUT the initial implementation in this file passed `[...Buffer.alloc(32)]` as default!
    // That would break it.
    // So we MUST re-calculate it to be safe, or ensure we fetched it.

    // Let's safe-guard by recalculating it using the same logic as `agents.ts` and `lib.rs`
    const crypto = await import('crypto');
    const salt = Buffer.from('BlinkPay');
    const maxBn = new BN(currentMaxPerTx);
    const categoryBuf = Buffer.alloc(1);
    categoryBuf.writeUInt8(currentCategory, 0);

    const hashInput = Buffer.concat([
        maxBn.toArrayLike(Buffer, 'le', 8),
        categoryBuf,
        salt
    ]);

    const newPolicyHash = crypto.createHash('sha256').update(hashInput).digest();

    // Build instruction
    const ix = await program.methods.setPolicy(
        [...newPolicyHash],  // Use recalculated hash
        currentCategory,
        currentMaxPerTx,
        freeze
    ).accounts({
        agent: agentPubkey,
        agentPolicy: policyPda,
        payer: userPubkey,
        systemProgram: SystemProgram.programId,
    }).instruction();

    const transaction = new Transaction();
    transaction.add(ix);

    // Add memo for UX
    const memoIx = new TransactionInstruction({
        keys: [],
        programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        data: Buffer.from(`AgentBlinkPay: ${freeze ? 'Freeze' : 'Unfreeze'} agent ${agent.name || agent.id}`),
    });
    transaction.add(memoIx);

    // Set recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;

    // PARTIAL SIGN by Agent
    transaction.partialSign(agentKeypair);

    return transaction;
}

/**
 * Builds a transaction to top up an agent's USDC balance.
 * 
 * This transfers USDC from the user's wallet to the agent's associated token account.
 */
async function buildTopupTx(
    connection: Connection,
    userPubkey: PublicKey,
    agent: db.Agent,
    amount: number
): Promise<Transaction> {
    // =========================================================================
    // SPL TOKEN TRANSFER (Manual Construction)
    // =========================================================================

    // 1. Get Agent's Circle Wallet Address
    const agentCircleAddress = await import('../services/circle').then(m => m.getWalletAddress(agent.circle_wallet_id));
    const agentPubkey = new PublicKey(agentCircleAddress);

    // 2. Derive ATA (Associated Token Account) for User and Agent
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

    // Devnet USDC Mint (fallback to standard Devnet USDC if env missing)
    // 4zMMC9MRTGMfUW4mW20q5fyrkA48qGbT2bDD5E6uA
    const MINT_STR = process.env.CIRCLE_USDC_TOKEN_ID || '4zMMC9MRTGMfUW4mW20q5fyrkA48qGbT2bDD5E6uA';
    // Note: CIRCLE_USDC_TOKEN_ID might be a UUID for Circle API, but here we need PKEY.
    // The user might have set it to the Mint address in .env for backend usage?
    // Let's assume MINT_STR is the Mint Address.
    let mintPubkey: PublicKey;
    try {
        mintPubkey = new PublicKey(MINT_STR);
    } catch {
        console.warn(`[Actions] Invalid Mint PKey in env, using Devnet default.`);
        mintPubkey = new PublicKey('4zMMC9MRTGMfUW4mW20q5fyrkA48qGbT2bDD5E6uA');
    }

    const getAta = (owner: PublicKey) => {
        return PublicKey.findProgramAddressSync(
            [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
            ASSOCIATED_TOKEN_PROGRAM_ID
        )[0];
    };

    const userAta = getAta(userPubkey);
    const agentAta = getAta(agentPubkey);

    const transaction = new Transaction();

    // 3. Create Transfer Instruction
    // SPL Token Instruction Layout: [Instruction (1 byte), Amount (8 bytes u64)]
    // Transfer instruction index is 3
    const amountUnits = BigInt(amount * 1_000_000); // 6 decimals
    const dataLayout = Buffer.alloc(9);
    dataLayout.writeUInt8(3, 0); // Instruction 3 = Transfer
    dataLayout.writeBigUInt64LE(amountUnits, 1);

    const transferIx = new TransactionInstruction({
        keys: [
            { pubkey: userAta, isSigner: false, isWritable: true },
            { pubkey: agentAta, isSigner: false, isWritable: true },
            { pubkey: userPubkey, isSigner: true, isWritable: false }, // Owner
        ],
        programId: TOKEN_PROGRAM_ID,
        data: dataLayout,
    });

    transaction.add(transferIx);

    // Add memo for clarity
    const memoIx = new TransactionInstruction({
        keys: [],
        programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        data: Buffer.from(`AgentBlinkPay: Top up ${amount} USDC`),
    });
    transaction.add(memoIx);

    // Set recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;

    return transaction;
}

export default router;
