/**
 * Circle Integration Service (Stubbed)
 * 
 * This module provides stubbed functions for Circle Programmable Wallets
 * and USDC transfers. In production, these would call the actual Circle APIs.
 * 
 * Circle APIs used:
 * - Programmable Wallets: https://developers.circle.com/api-reference/wallets
 * - Transfers: https://developers.circle.com/api-reference/transfers
 * - Gas Station: Sponsors gas fees for Solana transactions
 * 
 * @see https://developers.circle.com/docs
 */

import axios from 'axios';
import crypto from 'crypto';

// =============================================================================
// CONFIGURATION
// =============================================================================

// These would be set via environment variables in production
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || 'TEST_API_KEY';
const CIRCLE_API_URL = process.env.CIRCLE_API_URL || 'https://api.circle.com/v1';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || 'TEST_ENTITY_SECRET';

// USDC token configuration
const USDC_SOLANA_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // Mainnet USDC

// =============================================================================
// WALLET MANAGEMENT
// =============================================================================

/**
 * Creates a new Circle Programmable Wallet for an agent or merchant.
 * 
 * In production, this would:
 * 1. Generate a unique wallet set ID if needed
 * 2. Call POST /v1/w3s/user/wallets to create the wallet
 * 3. Return the wallet ID for storing in our database
 * 
 * @param label - Human-readable label for the wallet (e.g., "Agent: my-agent-001")
 * @returns The Circle wallet ID
 * 
 * @example
 * const walletId = await createCircleWallet("Agent: agent-123");
 * // Returns: "wallet_abc123..."
 */
export async function createCircleWallet(label: string): Promise<string> {
    console.log(`[Circle Stub] Creating wallet with label: ${label}`);

    // =========================================================================
    // TODO: Implement actual Circle API call
    // =========================================================================
    // 
    // const response = await axios.post(
    //   `${CIRCLE_API_URL}/w3s/user/wallets`,
    //   {
    //     idempotencyKey: crypto.randomUUID(),
    //     blockchains: ['SOL'],
    //     metadata: [{ name: 'label', refId: label }],
    //     entitySecretCiphertext: encryptEntitySecret(CIRCLE_ENTITY_SECRET),
    //   },
    //   {
    //     headers: {
    //       'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    //       'Content-Type': 'application/json',
    //     },
    //   }
    // );
    // 
    // return response.data.data.wallets[0].id;
    // =========================================================================

    // Stub: Generate a fake wallet ID
    const stubWalletId = `wallet_${crypto.randomBytes(16).toString('hex')}`;
    console.log(`[Circle Stub] Created wallet: ${stubWalletId}`);

    return stubWalletId;
}

/**
 * Gets the USDC balance for a Circle wallet.
 * 
 * @param walletId - The Circle wallet ID
 * @returns Balance in USDC (human-readable, e.g., "100.50")
 */
export async function getWalletBalance(walletId: string): Promise<string> {
    console.log(`[Circle Stub] Getting balance for wallet: ${walletId}`);

    // =========================================================================
    // TODO: Implement actual Circle API call
    // =========================================================================
    // 
    // const response = await axios.get(
    //   `${CIRCLE_API_URL}/w3s/wallets/${walletId}/balances`,
    //   {
    //     headers: { 'Authorization': `Bearer ${CIRCLE_API_KEY}` },
    //   }
    // );
    // 
    // const usdcBalance = response.data.data.tokenBalances.find(
    //   (b: any) => b.token.symbol === 'USDC'
    // );
    // 
    // return usdcBalance?.amount || '0';
    // =========================================================================

    // Stub: Return a random balance for demo
    const stubBalance = (Math.random() * 1000).toFixed(2);
    console.log(`[Circle Stub] Balance: ${stubBalance} USDC`);

    return stubBalance;
}

// =============================================================================
// USDC TRANSFERS
// =============================================================================

/**
 * Transfer USDC from one Circle wallet to another.
 * 
 * This is called when a MeterPaid event is received from Solana.
 * The idempotency key ensures that retries don't cause double transfers.
 * 
 * Idempotency key format: hash(agent_pubkey + meter_pubkey + nonce)
 * This ensures each unique payment can only be processed once.
 * 
 * @param fromWalletId - Source wallet ID (agent's wallet)
 * @param toWalletId - Destination wallet ID (merchant's wallet)
 * @param amount - Amount in USDC smallest units (e.g., "500000" for $0.50)
 * @param idempotencyKey - Unique key to prevent duplicate transfers
 * @returns The Circle transfer ID
 * 
 * @throws Error if transfer fails (insufficient balance, network error, etc.)
 * 
 * @example
 * await transferUsdc(
 *   "wallet_agent123",
 *   "wallet_merchant456",
 *   "500000",  // $0.50 in smallest units
 *   "hash_of_agent_meter_nonce"
 * );
 */
export async function transferUsdc(
    fromWalletId: string,
    toWalletId: string,
    amount: string,
    idempotencyKey: string,
): Promise<string> {
    console.log(`[Circle Stub] Transfer USDC:`);
    console.log(`  From: ${fromWalletId}`);
    console.log(`  To: ${toWalletId}`);
    console.log(`  Amount: ${amount} (smallest units)`);
    console.log(`  Idempotency Key: ${idempotencyKey}`);

    // =========================================================================
    // TODO: Implement actual Circle API call
    // =========================================================================
    // 
    // The Circle transfer flow:
    // 1. Create a transfer request with the idempotency key
    // 2. Sign the transaction (handled by Circle for custodial wallets)
    // 3. Submit to the Solana network
    // 4. Wait for confirmation
    // 
    // const response = await axios.post(
    //   `${CIRCLE_API_URL}/w3s/developer/transactions/transfer`,
    //   {
    //     idempotencyKey,
    //     entitySecretCiphertext: encryptEntitySecret(CIRCLE_ENTITY_SECRET),
    //     amounts: [amount],
    //     destinationAddress: toWalletId, // or actual Solana address
    //     tokenId: USDC_TOKEN_ID, // Circle's internal USDC token ID
    //     walletId: fromWalletId,
    //     blockchain: 'SOL',
    //     feeLevel: 'MEDIUM', // or use Gas Station for sponsored fees
    //   },
    //   {
    //     headers: {
    //       'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    //       'Content-Type': 'application/json',
    //     },
    //   }
    // );
    // 
    // // Poll for completion
    // const transferId = response.data.data.id;
    // await pollTransferStatus(transferId);
    // 
    // return transferId;
    // =========================================================================

    // Stub: Simulate transfer with small delay
    await new Promise(resolve => setTimeout(resolve, 100));

    const stubTransferId = `transfer_${crypto.randomBytes(16).toString('hex')}`;
    console.log(`[Circle Stub] Transfer completed: ${stubTransferId}`);

    return stubTransferId;
}

// =============================================================================
// GAS STATION (SPONSORED TRANSACTIONS)
// =============================================================================

/**
 * Sponsors gas fees for a Solana transaction using Circle Gas Station.
 * 
 * This allows agents to submit transactions without holding SOL for gas.
 * Gas Station pays the fees and the cost is settled in USDC.
 * 
 * @param serializedTransaction - Base64-encoded serialized transaction
 * @returns The sponsored transaction (ready to submit)
 */
export async function sponsorTransaction(
    serializedTransaction: string,
): Promise<string> {
    console.log(`[Circle Stub] Sponsoring transaction...`);

    // =========================================================================
    // TODO: Implement actual Circle Gas Station API call
    // =========================================================================
    // 
    // const response = await axios.post(
    //   `${CIRCLE_API_URL}/gas-station/sponsor`,
    //   {
    //     blockchain: 'SOL',
    //     transaction: serializedTransaction,
    //   },
    //   {
    //     headers: {
    //       'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    //       'Content-Type': 'application/json',
    //     },
    //   }
    // );
    // 
    // return response.data.data.sponsoredTransaction;
    // =========================================================================

    // Stub: Return the same transaction (would be modified with sponsor signature in production)
    console.log(`[Circle Stub] Transaction sponsored`);
    return serializedTransaction;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generates an idempotency key from payment details.
 * 
 * This ensures each unique (agent, meter, nonce) combination
 * can only result in one Circle transfer, preventing duplicates
 * even if our event listener processes the same event multiple times.
 * 
 * @param agentPubkey - Agent's Solana public key
 * @param meterPubkey - Meter's Solana public key
 * @param nonce - Payment nonce
 * @returns Hex-encoded hash suitable for use as idempotency key
 */
export function generateIdempotencyKey(
    agentPubkey: string,
    meterPubkey: string,
    nonce: number,
): string {
    const data = `${agentPubkey}:${meterPubkey}:${nonce}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Converts USDC amount from smallest units to human-readable format.
 * 
 * USDC has 6 decimal places on Solana.
 * e.g., 1000000 smallest units = 1.00 USDC
 * 
 * @param smallestUnits - Amount in smallest units
 * @returns Human-readable string (e.g., "1.50")
 */
export function formatUsdcAmount(smallestUnits: number | string): string {
    const units = typeof smallestUnits === 'string' ? parseInt(smallestUnits, 10) : smallestUnits;
    return (units / 1_000_000).toFixed(6);
}

/**
 * Converts USDC amount from human-readable to smallest units.
 * 
 * @param humanReadable - Amount as string (e.g., "1.50")
 * @returns Amount in smallest units
 */
export function parseUsdcAmount(humanReadable: string): number {
    return Math.floor(parseFloat(humanReadable) * 1_000_000);
}
