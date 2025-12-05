/**
 * AgentBlinkPay SDK
 * 
 * TypeScript SDK for AI agents to call paywalled APIs via x402.
 * 
 * Features:
 * - Automatic 402 handling with payment retry
 * - ZK proof generation (delegated to backend)
 * - Credit management
 * 
 * @example
 * ```typescript
 * import { AgentClient } from '@agentblinkpay/sdk';
 * 
 * const agent = new AgentClient({
 *   agentId: 'my-agent-123',
 *   apiKey: 'ak_xxx...',
 *   gatewayBaseUrl: 'https://gateway.agentblinkpay.com',
 *   backendBaseUrl: 'https://api.agentblinkpay.com',
 * });
 * 
 * // Make a paywalled API call - automatically handles 402 + payment
 * const response = await agent.callPaywalledApi(
 *   'meter-456',
 *   '/v1/chat/completions',
 *   {
 *     method: 'POST',
 *     body: JSON.stringify({ model: 'gpt-4', messages: [...] }),
 *   }
 * );
 * 
 * const data = await response.json();
 * ```
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Configuration for the AgentClient.
 */
export interface AgentConfig {
    /** Unique agent identifier */
    agentId: string;

    /** API key for authentication */
    apiKey: string;

    /** Base URL of the x402 gateway (e.g., 'https://gateway.agentblinkpay.com') */
    gatewayBaseUrl: string;

    /** Base URL of the backend API (e.g., 'https://api.agentblinkpay.com') */
    backendBaseUrl: string;

    /** Optional: Maximum retry attempts for 402 handling (default: 1) */
    maxRetries?: number;

    /** Optional: Timeout in milliseconds for requests (default: 30000) */
    timeout?: number;
}

/**
 * Utility for USDC Unit conversion (6 decimals).
 */
export const UsdcUnits = {
    /** Converts human-readable USDC to base units (e.g., 1.5 -> 1500000) */
    toBaseUnits: (amount: number): number => Math.floor(amount * 1_000_000),

    /** Converts base units to human-readable USDC (e.g., 1500000 -> 1.5) */
    fromBaseUnits: (amount: number): number => amount / 1_000_000,
};

/**
 * x402 payment metadata returned by gateway on 402 response.
 */
export interface X402Metadata {
    type: 'x402';
    meterId: string;
    amount: number;
    category: number;
    paymentInstructions: {
        meterPubkey: string;
        programId: string;
        network: string;
    };
}

/**
 * Payment response from backend.
 */
interface PaymentResponse {
    success: boolean;
    paymentId?: string;
    creditId?: string;
    nonce?: number;
    message?: string;
    error?: string;
}

// =============================================================================
// AGENT CLIENT
// =============================================================================

/**
 * AgentBlinkPay SDK Client
 * 
 * Provides methods for AI agents to interact with paywalled APIs
 * using the x402 payment protocol.
 */
export class AgentClient {
    private config: Required<AgentConfig>;

    /**
     * Creates a new AgentClient.
     * 
     * @param config - Agent configuration
     */
    constructor(config: AgentConfig) {
        this.config = {
            ...config,
            maxRetries: config.maxRetries ?? 1,
            timeout: config.timeout ?? 30000,
        };

        // Validate config
        if (!config.agentId) throw new Error('agentId is required');
        if (!config.apiKey) throw new Error('apiKey is required');
        if (!config.gatewayBaseUrl) throw new Error('gatewayBaseUrl is required');
        if (!config.backendBaseUrl) throw new Error('backendBaseUrl is required');
    }

    /**
     * Calls a paywalled API endpoint.
     * 
     * If the initial request returns 402, automatically:
     * 1. Parses x402 metadata
     * 2. Triggers payment via backend
     * 3. Retries the request
     * 
     * @param meterId - The meter ID for the API
     * @param path - Path to append to the gateway URL (e.g., '/v1/chat')
     * @param options - Fetch options (method, body, headers, etc.)
     * @returns The final response from the upstream API
     * 
     * @throws Error if payment fails or max retries exceeded
     * 
     * @example
     * ```typescript
     * const response = await agent.callPaywalledApi(
     *   'openai-chat-meter',
     *   '/v1/chat/completions',
     *   {
     *     method: 'POST',
     *     headers: { 'Content-Type': 'application/json' },
     *     body: JSON.stringify({
     *       model: 'gpt-4',
     *       messages: [{ role: 'user', content: 'Hello!' }],
     *     }),
     *   }
     * );
     * ```
     */
    async callPaywalledApi(
        meterId: string,
        path: string,
        options?: RequestInit
    ): Promise<Response> {
        const url = `${this.config.gatewayBaseUrl}/m/${meterId}${path}`;

        console.log(`[AgentSDK] Calling: ${url}`);

        // Build headers with authentication
        const headers = new Headers(options?.headers);
        headers.set('x-agent-id', this.config.agentId);
        headers.set('x-agent-api-key', this.config.apiKey);

        // Make initial request
        let response = await this.fetchWithTimeout(url, {
            ...options,
            headers,
        });

        // If 402, handle payment and retry
        if (response.status === 402) {
            console.log(`[AgentSDK] Received 402, initiating payment...`);

            const x402Metadata = await response.json() as X402Metadata;

            // Trigger payment via backend
            await this.handlePayment(x402Metadata);

            // Retry the request
            console.log(`[AgentSDK] Payment completed, retrying request...`);
            response = await this.fetchWithTimeout(url, {
                ...options,
                headers,
            });

            // If still 402, something went wrong
            if (response.status === 402) {
                throw new Error('Payment completed but still received 402. Credit may not have been recorded.');
            }
        }

        return response;
    }

    /**
     * Handles a 402 payment by calling the backend.
     * 
     * The backend will:
     * 1. Generate a ZK proof
     * 2. Submit authorize_payment_with_proof transaction
     * 3. Submit record_meter_payment transaction
     * 4. Create a credit record
     * 
     * @param metadata - x402 metadata from the gateway
     */
    private async handlePayment(metadata: X402Metadata): Promise<void> {
        console.log(`[AgentSDK] Processing payment:`, {
            meterId: metadata.meterId,
            amount: metadata.amount,
            category: metadata.category,
        });

        // =========================================================================
        // ZK Proof Generation (Optional: Local vs Backend)
        // =========================================================================
        // 
        // Option A: Generate proof locally in the agent (requires Noir WASM)
        // 
        // import { Noir } from '@noir-lang/noir_js';
        // 
        // const circuit = await Noir.compile('payment_policy');
        // const proof = await circuit.generateProof({
        //   amount: BigInt(metadata.amount),
        //   category: BigInt(metadata.category),
        //   policy_hash: await this.getPolicyHash(),
        //   max_per_tx: BigInt(await this.getMaxPerTx()),
        //   allowed_category: BigInt(await this.getAllowedCategory()),
        //   policy_salt: await this.getPolicySalt(),
        // });
        // 
        // Then send proof to backend:
        // await this.sendPaymentWithProof(metadata, proof);
        // 
        // Option B: Delegate proof generation to backend (current implementation)
        // - Backend has access to policy secrets
        // - Simpler for hackathon
        // =========================================================================

        const paymentUrl = `${this.config.backendBaseUrl}/agents/${this.config.agentId}/pay`;

        const paymentResponse = await this.fetchWithTimeout(paymentUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-agent-api-key': this.config.apiKey,
            },
            body: JSON.stringify({
                meterId: metadata.meterId,
                amount: metadata.amount,
                category: metadata.category,
                meterPubkey: metadata.paymentInstructions.meterPubkey,
            }),
        });

        if (!paymentResponse.ok) {
            const error = await paymentResponse.json();
            throw new Error(`Payment failed: ${(error as any).error || paymentResponse.statusText}`);
        }

        const result = await paymentResponse.json() as PaymentResponse;

        if (!result.success) {
            throw new Error(`Payment failed: ${result.error || 'Unknown error'}`);
        }

        console.log(`[AgentSDK] Payment successful:`, {
            paymentId: result.paymentId,
            creditId: result.creditId,
        });
    }

    /**
     * Checks if the agent has credit for a specific meter.
     * 
     * @param meterId - The meter ID to check
     * @returns True if credit is available
     */
    async hasCredit(meterId: string): Promise<boolean> {
        const url = `${this.config.gatewayBaseUrl}/m/${meterId}/credit-status`;

        const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'x-agent-id': this.config.agentId,
                'x-agent-api-key': this.config.apiKey,
            },
        });

        if (!response.ok) {
            return false;
        }

        const data = await response.json() as any;
        return data.hasCredit === true;
    }

    /**
     * Gets the agent's current status.
     * 
     * @returns Agent status including balance and frozen state
     */
    async getStatus(): Promise<{
        id: string;
        name: string;
        circleBalance: string;
        recentSpend: string;
        frozen: boolean;
    }> {
        const url = `${this.config.backendBaseUrl}/agents/${this.config.agentId}`;

        const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'x-agent-api-key': this.config.apiKey,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to get agent status: ${response.statusText}`);
        }

        return response.json() as any;
    }

    /**
     * Fetch with timeout support.
     */
    private async fetchWithTimeout(
        url: string,
        options?: RequestInit
    ): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            return await fetch(url, {
                ...options,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default AgentClient;

// Re-export types for convenience
export type { PaymentResponse };
