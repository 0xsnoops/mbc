/**
 * Catan Demo Integration - Full E2E Demo
 * 
 * This file demonstrates how a hypothetical Catan game engine would use
 * the AgentBlinkPay SDK to enable AI agents to pay for game actions.
 * 
 * Each game action (build road, settlement, trade) costs USDC and is
 * metered through the x402 gateway. Agents must have sufficient balance
 * and comply with their spending policies to execute actions.
 * 
 * Run with: npx ts-node examples/catan-demo.ts
 */

import { AgentClient, AgentConfig } from '../sdk/src/index';
import axios from 'axios';

// =============================================================================
// CONFIGURATION
// =============================================================================

const API_URL = process.env.API_URL || 'http://localhost:3000';
const CATEGORY_CATAN = 4; // CATAN_ACTION category

// Pricing (in base units - 6 decimals)
const ACTION_PRICES = {
    build_road: 100000,      // $0.10 to build a road
    build_settlement: 250000, // $0.25 for a settlement
    build_city: 500000,      // $0.50 for a city
    trade: 50000,            // $0.05 per trade
    roll_dice: 10000,        // $0.01 to roll dice
};

// =============================================================================
// GAME STATE
// =============================================================================

interface GameState {
    currentPlayer: string;
    resources: Record<string, number>;
    roads: Array<{ from: string; to: string }>;
    settlements: string[];
    cities: string[];
}

interface GameAction {
    type: keyof typeof ACTION_PRICES;
    params: Record<string, any>;
}

interface ActionResult {
    success: boolean;
    message: string;
    newState?: Partial<GameState>;
}

// =============================================================================
// CATAN AGENT CLASS
// =============================================================================

class CatanAgent {
    public id: string;
    public name: string;
    public apiKey: string;
    public pubkey: string;
    private client: AgentClient;
    private gameState: GameState;
    private meterId: string;

    constructor(
        id: string,
        name: string,
        apiKey: string,
        pubkey: string,
        meterId: string,
        initialState: GameState
    ) {
        this.id = id;
        this.name = name;
        this.apiKey = apiKey;
        this.pubkey = pubkey;
        this.meterId = meterId;
        this.gameState = initialState;

        this.client = new AgentClient({
            agentId: id,
            apiKey: apiKey,
            gatewayBaseUrl: API_URL,
            backendBaseUrl: API_URL,
        });
    }

    async executeAction(action: GameAction): Promise<ActionResult> {
        console.log(`  [${this.name}] Executing action: ${action.type} (cost: $${ACTION_PRICES[action.type] / 1000000})`);

        try {
            const response = await this.client.callPaywalledApi(
                this.meterId,
                `/action/${action.type}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        player: this.name,
                        ...action.params,
                    }),
                }
            );

            if (!response.ok) {
                const error = await response.json();
                return {
                    success: false,
                    message: error.message || 'Action failed',
                };
            }

            const result = await response.json();
            if (result.newState) {
                this.gameState = { ...this.gameState, ...result.newState };
            }

            return {
                success: true,
                message: result.message || 'OK',
                newState: result.newState,
            };

        } catch (error) {
            console.error(`  [${this.name}] ❌ Action failed:`, error instanceof Error ? error.message : error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    async rollDice(): Promise<ActionResult> {
        return this.executeAction({ type: 'roll_dice', params: {} });
    }

    async buildRoad(from: string, to: string): Promise<ActionResult> {
        return this.executeAction({ type: 'build_road', params: { from, to } });
    }

    async buildSettlement(location: string): Promise<ActionResult> {
        return this.executeAction({ type: 'build_settlement', params: { location } });
    }

    async getStatus() {
        return this.client.getStatus();
    }
}

// =============================================================================
// DEMO ORCHESTRATION
// =============================================================================

async function createCatanMeter(): Promise<string> {
    console.log('\n📦 Creating Catan game meter...');

    try {
        const response = await axios.post(`${API_URL}/providers/meters`, {
            name: 'Catan Game Actions',
            upstreamUrl: 'https://httpbin.org/anything', // Mock API
            pricePerCall: ACTION_PRICES.roll_dice, // Base price
            category: CATEGORY_CATAN, // CATAN_ACTION
        });

        console.log(`   ✅ Meter created: ${response.data.id}`);
        console.log(`   📍 Pubkey: ${response.data.meter_pubkey}`);
        return response.data.id;
    } catch (err: any) {
        console.error('   ❌ Failed to create meter:', err.response?.data || err.message);
        throw err;
    }
}

async function createCatanAgent(name: string, color: string, meterId: string): Promise<CatanAgent> {
    console.log(`\n🤖 Creating agent: ${name} (${color})...`);

    try {
        const response = await axios.post(`${API_URL}/agents`, {
            name: `Catan-${name}`,
            allowedCategory: CATEGORY_CATAN,
            maxPerTx: 1000000, // $1 max per action
        });

        console.log(`   ✅ Agent created: ${response.data.id}`);
        console.log(`   🔑 API Key: ${response.data.apiKey.substring(0, 20)}...`);
        console.log(`   💰 Wallet: ${response.data.circleWalletId}`);

        return new CatanAgent(
            response.data.id,
            name,
            response.data.apiKey,
            response.data.agentPubkey,
            meterId,
            {
                currentPlayer: name,
                resources: { wood: 3, brick: 3, sheep: 2, wheat: 1, ore: 0 },
                roads: [],
                settlements: [`${color}1`],
                cities: [],
            }
        );
    } catch (err: any) {
        console.error(`   ❌ Failed to create agent:`, err.response?.data || err.message);
        throw err;
    }
}

async function freezeAgent(agentId: string): Promise<void> {
    console.log(`\n🔒 Freezing agent ${agentId} via Blink...`);
    console.log(`   📍 Blink URL: https://dial.to/?action=solana-action:${API_URL}/api/actions/agent?agentId=${agentId}%26action=freeze`);

    // In a real demo, user would click this link
    // For automation, we call the backend directly
    try {
        const response = await axios.post(
            `${API_URL}/api/actions/agent?agentId=${agentId}&action=freeze`,
            { account: 'So11111111111111111111111111111111111111112' }
        );
        console.log(`   ✅ Freeze transaction generated`);
        console.log(`   ℹ️ In a real demo, user would sign this with their wallet`);
    } catch (err: any) {
        console.log(`   ⚠️ Mock freeze (program may not be deployed):`, err.response?.data || err.message);
    }
}

async function playTurn(agent: CatanAgent, turnNumber: number): Promise<boolean> {
    console.log(`\n🎲 Turn ${turnNumber} for ${agent.name}`);

    try {
        const status = await agent.getStatus();
        console.log(`   💰 Balance: $${status.circleBalance}`);
        console.log(`   ❄️ Frozen: ${status.frozen}`);

        if (status.frozen) {
            console.log(`   ⛔ ${agent.name} is FROZEN! Cannot play.`);
            return false;
        }

        // Roll dice
        const roll = await agent.rollDice();
        if (!roll.success) {
            console.log(`   ❌ Roll failed: ${roll.message}`);
            return false;
        }
        console.log(`   🎲 Rolled: ${roll.message}`);

        // Build a road
        const road = await agent.buildRoad(`A${turnNumber}`, `B${turnNumber}`);
        if (road.success) {
            console.log(`   🛤️ Built road!`);
        } else {
            console.log(`   ❌ Road failed: ${road.message}`);
        }

        return true;

    } catch (err: any) {
        console.error(`   ❌ Turn failed:`, err.message);
        return false;
    }
}

// =============================================================================
// MAIN DEMO
// =============================================================================

async function runCatanDemo() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║         AgentBlinkPay - Catan Demo with AI Agents            ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Each agent pays USDC for game actions via x402 protocol     ║');
    console.log('║  Humans can freeze agents mid-game using Solana Blinks       ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    try {
        // 1. Create the game meter
        const meterId = await createCatanMeter();

        // 2. Create 4 AI agents (Red, Blue, Green, Yellow)
        const agents: CatanAgent[] = [];
        const colors = ['Red', 'Blue', 'Green', 'Yellow'];

        for (const color of colors) {
            const agent = await createCatanAgent(color, color.charAt(0), meterId);
            agents.push(agent);
        }

        console.log('\n' + '='.repeat(60));
        console.log('⚠️  IMPORTANT: Fund the agents with USDC before continuing!');
        console.log('    Each agent needs at least $1 USDC in their Circle wallet.');
        console.log('='.repeat(60));

        // 3. Simulate 3 rounds
        for (let round = 1; round <= 3; round++) {
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`                      ROUND ${round}`);
            console.log(`${'═'.repeat(60)}`);

            for (const agent of agents) {
                await playTurn(agent, round);

                // After round 2, freeze Blue player!
                if (round === 2 && agent.name === 'Blue') {
                    await freezeAgent(agent.id);
                    console.log('\n   🔴 Blue has been frozen by the human overseer!');
                }
            }

            // Small delay between rounds
            await new Promise(r => setTimeout(r, 1000));
        }

        // 4. Summary
        console.log('\n' + '═'.repeat(60));
        console.log('                    GAME SUMMARY');
        console.log('═'.repeat(60));

        for (const agent of agents) {
            const status = await agent.getStatus();
            console.log(`\n${agent.name}:`);
            console.log(`  💰 Final Balance: $${status.circleBalance}`);
            console.log(`  📊 Spent Today: $${status.recentSpend}`);
            console.log(`  ❄️ Frozen: ${status.frozen}`);
        }

        console.log('\n✅ Demo complete!');

    } catch (error) {
        console.error('\n❌ Demo failed:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    runCatanDemo().catch(console.error);
}

export { CatanAgent, playTurn, runCatanDemo, ACTION_PRICES };
