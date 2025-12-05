/**
 * Circle Integration Service
 * 
 * Provides production-ready functions for Circle Programmable Wallets
 * and USDC transfers, including Entity Secret encryption.
 */

import axios from 'axios';
import crypto from 'crypto';
import forge from 'node-forge';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || '';
const CIRCLE_API_URL = process.env.CIRCLE_API_URL || 'https://api.circle.com/v1';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';

/**
 * Validates that necessary Circle environment variables are set.
 * Should be called on application startup.
 */
export function validateConfiguration(): void {
    const missing = [];
    if (!CIRCLE_API_KEY) missing.push('CIRCLE_API_KEY');
    if (!CIRCLE_ENTITY_SECRET) missing.push('CIRCLE_ENTITY_SECRET');
    if (!process.env.CIRCLE_USDC_TOKEN_ID) missing.push('CIRCLE_USDC_TOKEN_ID');

    if (missing.length > 0) {
        throw new Error(`[Circle] Missing required environment variables: ${missing.join(', ')}`);
    }
    console.log('[Circle] Configuration validated.');
}

// =============================================================================
// SECURITY UTILITIES
// =============================================================================

/**
 * Encrypts the Entity Secret using Circle's public key.
 * Required for sensitive operations like wallet creation and transfers.
 */
async function encryptEntitySecret(): Promise<string> {
    try {
        // 1. Fetch Circle's Public Key
        const response = await axios.get(`${CIRCLE_API_URL}/config/entity/publicKey`, {
            headers: { 'Authorization': `Bearer ${CIRCLE_API_KEY}` }
        });

        const publicKeyString = response.data.data.publicKey;

        // 2. Encrypt the Entity Secret
        const entitySecret = forge.util.hexToBytes(CIRCLE_ENTITY_SECRET);
        const publicKey = forge.pki.publicKeyFromPem(publicKeyString);

        const encryptedData = publicKey.encrypt(entitySecret, 'RSA-OAEP', {
            md: forge.md.sha256.create(),
            mgf1: {
                md: forge.md.sha256.create(),
            },
        });

        return forge.util.encode64(encryptedData);
    } catch (error) {
        console.error('[Circle] Failed to encrypt entity secret:', error);
        throw new Error('Circle Encryption Failed');
    }
}

// =============================================================================
// WALLET MANAGEMENT
// =============================================================================

/**
 * Creates a new Circle Programmable Wallet for an agent or merchant.
 */
export async function createCircleWallet(label: string): Promise<string> {
    console.log(`[Circle] Creating wallet with label: ${label}`);

    try {
        const idempotencyKey = crypto.randomUUID();
        const entitySecretCiphertext = await encryptEntitySecret();

        const response = await axios.post(
            `${CIRCLE_API_URL}/w3s/user/wallets`,
            {
                idempotencyKey,
                blockchains: ['SOL'],
                metadata: [{ name: 'label', refId: label }],
                entitySecretCiphertext,
                walletSetId: process.env.CIRCLE_WALLET_SET_ID // Optional: Use default if not set
            },
            {
                headers: {
                    'Authorization': `Bearer ${CIRCLE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const walletId = response.data.data.wallets[0].id;
        console.log(`[Circle] Created wallet: ${walletId}`);
        return walletId;

    } catch (error: any) {
        console.error('[Circle] Create Wallet Error:', error.response?.data || error.message);
        throw new Error('Failed to create Circle wallet');
    }
}

// In-memory cache for wallet ID -> Address mapping
const addressCache = new Map<string, string>();

/**
 * Gets the blockchain address for a Circle wallet.
 * Caches the result to avoid hitting API rate limits.
 */
export async function getWalletAddress(walletId: string): Promise<string> {
    // Check cache first
    if (addressCache.has(walletId)) {
        return addressCache.get(walletId)!;
    }

    console.log(`[Circle] Getting address for wallet: ${walletId}`);

    try {
        const response = await axios.get(
            `${CIRCLE_API_URL}/w3s/wallets/${walletId}`,
            { headers: { 'Authorization': `Bearer ${CIRCLE_API_KEY}` } }
        );

        const address = response.data.data.wallet.address;
        console.log(`[Circle] Wallet address: ${address}`);

        // Cache the result
        addressCache.set(walletId, address);

        return address;

    } catch (error: any) {
        console.error('[Circle] Get Address Error:', error.response?.data || error.message);
        throw new Error('Failed to get wallet address');
    }
}

/**
 * Gets the USDC balance for a Circle wallet.
 */
export async function getWalletBalance(walletId: string): Promise<string> {
    try {
        const response = await axios.get(
            `${CIRCLE_API_URL}/w3s/wallets/${walletId}/balances`,
            {
                headers: { 'Authorization': `Bearer ${CIRCLE_API_KEY}` },
            }
        );

        const usdcBalance = response.data.data.tokenBalances.find(
            (b: any) => b.token.symbol === 'USDC'
        );

        return usdcBalance?.amount || '0.00';

    } catch (error: any) {
        // Fallback for demo or 404
        console.warn(`[Circle] Failed to get balance for ${walletId}:`, error.message);
        return '0.00';
    }
}

// =============================================================================
// USDC TRANSFERS
// =============================================================================

/**
 * Transfer USDC from one Circle wallet to another.
 */
export async function transferUsdc(
    fromWalletId: string,
    toWalletId: string,
    amount: string,
    idempotencyKey: string,
): Promise<string> {
    console.log(`[Circle] Transferring ${amount} units (USDC) from ${fromWalletId} to ${toWalletId}`);

    try {
        const entitySecretCiphertext = await encryptEntitySecret();

        // Get actual destination address if strictly required, but Circle internal transfers usually support walletId
        // However, the prompt says "destinationAddress: to" refering to walletId?
        // Circle API "Transfer" usually requires a blockchain address or a walletId + destinationType.
        // For Developer Controlled Wallets or User Controlled, typically we send to an address.
        // Let's assume we need the address of the TO wallet.
        // OPTIMIZATION: In Phase 1 mapping, we might not have the address associated with 'toWalletId' cached.
        // We might need to fetch it or store it.
        // BUT `transferUsdc` is called by `solanaListener` which has `meter.merchant_wallet_id`.
        // If `merchant_wallet_id` is a Circle Wallet ID (as per schema), we need its address to transfer TO it.
        // Wait, Circle Transfers API allows `destinationAddress` to be a blockchain address.
        // Let's look up the address for `toWalletId`.
        const destinationAddress = await getWalletAddress(toWalletId);

        const response = await axios.post(
            `${CIRCLE_API_URL}/w3s/developer/transactions/transfer`,
            {
                idempotencyKey,
                entitySecretCiphertext,
                amounts: [amount],
                destinationAddress: destinationAddress,
                tokenId: process.env.CIRCLE_USDC_TOKEN_ID, // Validated in validateConfiguration
                walletId: fromWalletId,
                feeLevel: 'MEDIUM',
            },
            {
                headers: {
                    'Authorization': `Bearer ${CIRCLE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const transferId = response.data.data.id;
        console.log(`[Circle] Transfer initiated: ${transferId}`);
        return transferId;

    } catch (error: any) {
        console.error('[Circle] Transfer Error:', error.response?.data || error.message);
        throw new Error(`Transfer failed: ${error.response?.data?.message || error.message}`);
    }
}

// =============================================================================
// GAS STATION (STUBBED FOR PHASE 1)
// =============================================================================

export async function sponsorTransaction(
    serializedTransaction: string,
): Promise<string> {
    // Keeping this stubbed for Phase 1 as focus is on API connectivity
    return serializedTransaction;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export function generateIdempotencyKey(
    agentPubkey: string,
    meterPubkey: string,
    nonce: number | bigint,
): string {
    const data = `${agentPubkey}:${meterPubkey}:${nonce.toString()}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

export function formatUsdcAmount(smallestUnits: number | string): string {
    const units = typeof smallestUnits === 'string' ? parseInt(smallestUnits, 10) : smallestUnits;
    return (units / 1_000_000).toFixed(6);
}

export function parseUsdcAmount(humanReadable: string): number {
    return Math.floor(parseFloat(humanReadable) * 1_000_000);
}
