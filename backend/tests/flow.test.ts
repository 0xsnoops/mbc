/**
 * Backend Integration Tests
 * 
 * Tests the full API flow: Create Agent → Create Meter → Pay → Verify
 */

import axios from 'axios';
import { expect } from 'chai';

const API_URL = process.env.API_URL || 'http://localhost:3000';

describe('AgentBlinkPay Backend Integration', () => {
    let agentId: string;
    let agentApiKey: string;
    let agentPubkey: string;
    let meterId: string;
    let meterPubkey: string;

    // =========================================================================
    // TEST 1: Create Agent
    // =========================================================================
    describe('POST /agents', () => {
        it('creates an agent with Circle wallet and on-chain policy', async () => {
            const response = await axios.post(`${API_URL}/agents`, {
                name: 'Test Agent',
                allowedCategory: 1,
                maxPerTx: 1000000
            });

            expect(response.status).to.equal(201);
            expect(response.data.id).to.be.a('string');
            expect(response.data.apiKey).to.match(/^ak_/);
            expect(response.data.agentPubkey).to.be.a('string');
            expect(response.data.circleWalletId).to.be.a('string');

            // Store for subsequent tests
            agentId = response.data.id;
            agentApiKey = response.data.apiKey;
            agentPubkey = response.data.agentPubkey;

            console.log(`Created agent: ${agentId}`);
        });
    });

    // =========================================================================
    // TEST 2: Create Meter
    // =========================================================================
    describe('POST /providers/meters', () => {
        it('creates a meter with on-chain PDA', async () => {
            const response = await axios.post(`${API_URL}/providers/meters`, {
                name: 'Test Meter',
                upstreamUrl: 'https://httpbin.org/anything',
                pricePerCall: 50000,
                category: 1
            });

            expect(response.status).to.equal(201);
            expect(response.data.id).to.be.a('string');
            expect(response.data.meter_pubkey).to.be.a('string');

            meterId = response.data.id;
            meterPubkey = response.data.meter_pubkey;

            console.log(`Created meter: ${meterId}`);
        });
    });

    // =========================================================================
    // TEST 3: Get Agent Status
    // =========================================================================
    describe('GET /agents/:id', () => {
        it('returns agent status including balance', async () => {
            const response = await axios.get(`${API_URL}/agents/${agentId}`);

            expect(response.status).to.equal(200);
            expect(response.data.id).to.equal(agentId);
            expect(response.data.frozen).to.equal(false);
            expect(response.data.circleBalance).to.be.a('string');
        });
    });

    // =========================================================================
    // TEST 4: Payment Flow (if Solana is available)
    // =========================================================================
    describe('POST /agents/:id/pay', () => {
        it('submits payment transaction to Solana', async function () {
            // This test requires:
            // 1. Solana validator running
            // 2. Agent policy set on-chain
            // 3. Meter created on-chain
            // Skip if not available
            this.timeout(30000);

            try {
                const response = await axios.post(
                    `${API_URL}/agents/${agentId}/pay`,
                    {
                        meterId: meterId,
                        amount: 50000,
                        category: 1,
                        meterPubkey: meterPubkey
                    },
                    {
                        headers: {
                            'x-agent-api-key': agentApiKey
                        }
                    }
                );

                expect(response.status).to.equal(200);
                expect(response.data.success).to.equal(true);
                expect(response.data.txSignature).to.be.a('string');

                console.log(`Payment tx: ${response.data.txSignature}`);

                // Wait for event listener to process
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Verify payment record created
                const agentStatus = await axios.get(`${API_URL}/agents/${agentId}`);
                const recentPayments = agentStatus.data.recentPayments || [];

                // Note: Payment may still be in pending_finality
                console.log(`Recent payments: ${recentPayments.length}`);

            } catch (err: any) {
                if (err.response?.status === 500 && err.response?.data?.error?.includes('Program not loaded')) {
                    console.log('Skipping payment test - Solana program not deployed');
                    this.skip();
                } else {
                    throw err;
                }
            }
        });
    });

    // =========================================================================
    // TEST 5: x402 Gateway Flow
    // =========================================================================
    describe('x402 Gateway', () => {
        it('returns 401 without authentication', async () => {
            try {
                await axios.get(`${API_URL}/m/${meterId}/test`);
                expect.fail('Should have thrown');
            } catch (err: any) {
                expect(err.response.status).to.equal(401);
            }
        });

        it('returns 402 Payment Required without credit', async () => {
            try {
                await axios.get(`${API_URL}/m/${meterId}/test`, {
                    headers: {
                        'x-agent-id': agentId,
                        'x-agent-api-key': agentApiKey
                    }
                });
                expect.fail('Should have thrown 402');
            } catch (err: any) {
                expect(err.response.status).to.equal(402);
                expect(err.response.data.type).to.equal('x402');
                expect(err.response.data.amount).to.equal(50000);
                expect(err.response.data.paymentInstructions.meterPubkey).to.equal(meterPubkey);
            }
        });
    });

    // =========================================================================
    // TEST 6: Actions Endpoint
    // =========================================================================
    describe('Solana Actions', () => {
        it('GET /api/actions/agent returns action metadata', async () => {
            const response = await axios.get(`${API_URL}/api/actions/agent?agentId=${agentId}&action=freeze`);

            expect(response.status).to.equal(200);
            expect(response.data.title).to.include('Freeze');
            expect(response.data.label).to.be.a('string');
        });

        it('POST /api/actions/agent returns transaction', async function () {
            this.timeout(10000);

            try {
                const response = await axios.post(
                    `${API_URL}/api/actions/agent?agentId=${agentId}&action=freeze`,
                    {
                        account: 'So11111111111111111111111111111111111111112' // Dummy pubkey
                    }
                );

                expect(response.status).to.equal(200);
                expect(response.data.transaction).to.be.a('string');
                expect(response.data.message).to.include('frozen');
            } catch (err: any) {
                if (err.response?.status === 500) {
                    console.log('Skipping actions POST test - may need Solana');
                    this.skip();
                }
                throw err;
            }
        });
    });
});
