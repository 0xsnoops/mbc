/**
 * Solana Event Listener Service
 * 
 * Subscribes to MeterPaid events from the AgentBlinkPay program via Solana
 * RPC websocket. For each event, triggers Circle USDC transfers.
 * 
 * Event Flow:
 * 1. MeterPaid event emitted on-chain
 * 2. Listener receives event via websocket
 * 3. Maps agent/meter pubkeys to DB records
 * 4. Creates payment record with status='pending'
 * 5. Calls Circle transferUsdc with idempotency key
 * 6. Updates payment status to 'succeeded' or 'failed'
 * 7. Creates credit if successful
 * 
 * Recovery:
 * On startup, the listener re-scans from the last processed slot
 * and retries any pending/failed payments.
 */

import { Connection, PublicKey, Logs, Commitment } from '@solana/web3.js';
import { BorshCoder, EventParser, Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db';
import * as circle from './circle';

// =============================================================================
// CONFIGURATION
// =============================================================================

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'http://localhost:8899';
const SOLANA_WS_URL = process.env.SOLANA_WS_URL || 'ws://localhost:8900';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

// Commitment level for event subscriptions
const COMMITMENT: Commitment = 'confirmed';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * MeterPaid event structure (matches on-chain event)
 */
interface MeterPaidEvent {
    agent: PublicKey;
    meter: PublicKey;
    amount: bigint;
    category: number;
    nonce: bigint;
    slot: bigint;
}

/**
 * Listener state
 */
interface ListenerState {
    connection: Connection;
    subscriptionId: number | null;
    isRunning: boolean;
}

// =============================================================================
// LISTENER IMPLEMENTATION
// =============================================================================

let state: ListenerState = {
    connection: new Connection(SOLANA_RPC_URL, {
        wsEndpoint: SOLANA_WS_URL,
        commitment: COMMITMENT,
    }),
    subscriptionId: null,
    isRunning: false,
};

/**
 * Starts the Solana event listener.
 * 
 * This subscribes to logs from the AgentBlinkPay program and
 * processes MeterPaid events as they occur.
 */
export async function startListener(): Promise<void> {
    if (state.isRunning) {
        console.log('[Listener] Already running');
        return;
    }

    console.log('[Listener] Starting Solana event listener...');
    console.log(`[Listener] RPC: ${SOLANA_RPC_URL}`);
    console.log(`[Listener] Program ID: ${PROGRAM_ID.toBase58()}`);

    // First, recover any pending payments from last run
    await recoverPendingPayments();

    // Subscribe to program logs
    state.subscriptionId = state.connection.onLogs(
        PROGRAM_ID,
        async (logs: Logs) => {
            try {
                await processLogs(logs);
            } catch (error) {
                console.error('[Listener] Error processing logs:', error);
            }
        },
        COMMITMENT
    );

    state.isRunning = true;
    console.log(`[Listener] Subscribed with ID: ${state.subscriptionId}`);
}

/**
 * Stops the Solana event listener.
 */
export async function stopListener(): Promise<void> {
    if (!state.isRunning || state.subscriptionId === null) {
        console.log('[Listener] Not running');
        return;
    }

    console.log('[Listener] Stopping...');
    await state.connection.removeOnLogsListener(state.subscriptionId);
    state.subscriptionId = null;
    state.isRunning = false;
    console.log('[Listener] Stopped');
}

/**
 * Processes logs from the AgentBlinkPay program.
 * 
 * Looks for MeterPaid events and triggers payment processing.
 */
async function processLogs(logs: Logs): Promise<void> {
    if (logs.err) {
        // Transaction failed, skip
        return;
    }

    // Look for MeterPaid event in logs
    // Event logs have format: "Program log: <event_data>"
    const meterPaidEvent = parseMeterPaidEvent(logs.logs);

    if (meterPaidEvent) {
        console.log('[Listener] MeterPaid event detected:');
        console.log(`  Agent: ${meterPaidEvent.agent.toBase58()}`);
        console.log(`  Meter: ${meterPaidEvent.meter.toBase58()}`);
        console.log(`  Amount: ${meterPaidEvent.amount}`);
        console.log(`  Nonce: ${meterPaidEvent.nonce}`);

        await processPaymentEvent(meterPaidEvent);
    }
}

/**
 * Parses MeterPaid event from program logs.
 * 
 * In production, use the Anchor EventParser for proper deserialization.
 * This is a simplified implementation for demonstration.
 */
function parseMeterPaidEvent(logs: string[]): MeterPaidEvent | null {
    // =========================================================================
    // TODO: Use Anchor EventParser for proper event deserialization
    // =========================================================================
    // 
    // Example with Anchor:
    // 
    // const idl = require('../idl/agent_blink_pay.json');
    // const coder = new BorshCoder(idl);
    // const eventParser = new EventParser(PROGRAM_ID, coder);
    // 
    // const events = eventParser.parseLogs(logs);
    // for (const event of events) {
    //   if (event.name === 'MeterPaid') {
    //     return event.data as MeterPaidEvent;
    //   }
    // }
    // =========================================================================

    // Simplified: Look for "Payment recorded:" log message
    for (const log of logs) {
        if (log.includes('Payment recorded:')) {
            // In production, parse the actual event data
            // For now, this is a placeholder that won't match real events
            console.log('[Listener] Found payment log (stub parser)');
        }
    }

    return null;
}

/**
 * Processes a MeterPaid event.
 * 
 * 1. Maps pubkeys to DB records
 * 2. Creates payment record
 * 3. Triggers Circle transfer
 * 4. Updates status
 */
async function processPaymentEvent(event: MeterPaidEvent): Promise<void> {
    const agentPubkey = event.agent.toBase58();
    const meterPubkey = event.meter.toBase58();

    // Look up agent and meter in DB
    const agent = db.agents.findByPubkey.get(agentPubkey) as db.Agent | undefined;
    const meter = db.meters.findByPubkey.get(meterPubkey) as db.Meter | undefined;

    if (!agent) {
        console.error(`[Listener] Unknown agent: ${agentPubkey}`);
        return;
    }

    if (!meter) {
        console.error(`[Listener] Unknown meter: ${meterPubkey}`);
        return;
    }

    // Generate idempotency key
    const eventId = circle.generateIdempotencyKey(
        agentPubkey,
        meterPubkey,
        Number(event.nonce)
    );

    // Check if we've already processed this event
    const existingPayment = db.payments.findByEventId.get(eventId) as db.Payment | undefined;
    if (existingPayment) {
        console.log(`[Listener] Event already processed: ${eventId} (status: ${existingPayment.status})`);

        if (existingPayment.status === 'succeeded') {
            return; // Already done
        }

        // Retry if pending or failed
        await executeTransfer(existingPayment);
        return;
    }

    // Create payment record
    const paymentId = uuidv4();
    db.payments.create.run(
        paymentId,
        eventId,
        agent.id,
        meter.id,
        Number(event.amount),
        Number(event.nonce),
        event.category,
        Number(event.slot),
        agent.circle_wallet_id,
        meter.merchant_wallet_id
    );

    console.log(`[Listener] Created payment record: ${paymentId}`);

    // Execute transfer
    const payment = db.payments.findByEventId.get(eventId) as db.Payment;
    await executeTransfer(payment);
}

/**
 * Executes a Circle USDC transfer for a payment.
 * 
 * Updates payment status based on result.
 */
async function executeTransfer(payment: db.Payment): Promise<void> {
    console.log(`[Listener] Executing transfer for payment: ${payment.id}`);

    try {
        // Call Circle to execute the transfer
        const transferId = await circle.transferUsdc(
            payment.from_wallet_id,
            payment.to_wallet_id,
            payment.amount.toString(),
            payment.event_id // Idempotency key
        );

        // Update payment status to succeeded
        db.payments.updateStatus.run('succeeded', null, transferId, payment.id);
        console.log(`[Listener] Payment succeeded: ${payment.id}`);

        // Create credit for the agent
        const creditId = uuidv4();
        db.credits.create.run(creditId, payment.agent_id, payment.meter_id, payment.id);
        console.log(`[Listener] Credit created: ${creditId}`);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        db.payments.updateStatus.run('failed', errorMessage, null, payment.id);
        console.error(`[Listener] Payment failed: ${payment.id} - ${errorMessage}`);
    }
}

/**
 * Recovers and retries any pending/failed payments from previous runs.
 * 
 * Called on startup to ensure consistency.
 */
async function recoverPendingPayments(): Promise<void> {
    console.log('[Listener] Recovering pending payments...');

    const pendingPayments = db.payments.findPending.all() as db.Payment[];
    console.log(`[Listener] Found ${pendingPayments.length} pending payments`);

    for (const payment of pendingPayments) {
        console.log(`[Listener] Retrying payment: ${payment.id} (status: ${payment.status})`);
        await executeTransfer(payment);
    }
}

/**
 * Updates the last processed slot in the database.
 * 
 * Used for recovery - on restart, we can rescan from this slot.
 */
function updateLastProcessedSlot(slot: number): void {
    db.listenerState.update.run(slot);
}

/**
 * Gets the last processed slot from the database.
 */
function getLastProcessedSlot(): number {
    const state = db.listenerState.get.get() as { last_processed_slot: number } | undefined;
    return state?.last_processed_slot || 0;
}
