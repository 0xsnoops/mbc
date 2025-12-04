/**
 * Catan Demo Integration
 * 
 * This file demonstrates how a hypothetical Catan game engine would use
 * the AgentBlinkPay SDK to enable AI agents to pay for game actions.
 * 
 * Each game action (build road, settlement, trade) costs USDC and is
 * metered through the x402 gateway. Agents must have sufficient balance
 * and comply with their spending policies to execute actions.
 */

import { AgentClient, AgentConfig } from '@agentblinkpay/sdk';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Meter ID for Catan game actions (registered via /providers/meters)
const CATAN_METER_ID = 'catan-game-meter-001';

// Pricing (in USDC) - these would be set when registering the meter
const ACTION_PRICES = {
    build_road: 0.10,      // 10 cents to build a road
    build_settlement: 0.25, // 25 cents for a settlement
    build_city: 0.50,      // 50 cents for a city
    trade: 0.05,           // 5 cents per trade
    roll_dice: 0.01,       // 1 cent to roll dice
};

// =============================================================================
// GAME STATE (simplified)
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

/**
 * A Catan-playing AI agent that uses AgentBlinkPay for payments.
 */
export class CatanAgent {
    private client: AgentClient;
    private gameState: GameState;

    constructor(config: AgentConfig, initialState: GameState) {
        this.client = new AgentClient(config);
        this.gameState = initialState;
    }

    /**
     * Executes a game action by calling the paywalled Catan API.
     * 
     * The flow is:
     * 1. Call the Catan meter via x402 gateway
     * 2. If 402, SDK handles payment automatically
     * 3. After payment, API executes the action
     * 4. Return result and update local state
     */
    async executeAction(action: GameAction): Promise<ActionResult> {
        console.log(`[CatanAgent] Executing action: ${action.type}`);

        try {
            // Make the paywalled API call
            // The SDK handles 402 responses, ZK proofs, and payment automatically
            const response = await this.client.callPaywalledApi(
                CATAN_METER_ID,
                `/action/${action.type}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        player: this.gameState.currentPlayer,
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

            // Update local game state
            if (result.newState) {
                this.gameState = { ...this.gameState, ...result.newState };
            }

            console.log(`[CatanAgent] Action completed: ${result.message}`);

            return {
                success: true,
                message: result.message,
                newState: result.newState,
            };

        } catch (error) {
            console.error(`[CatanAgent] Action failed:`, error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    // Convenience methods for common actions

    async buildRoad(from: string, to: string): Promise<ActionResult> {
        return this.executeAction({
            type: 'build_road',
            params: { from, to },
        });
    }

    async buildSettlement(location: string): Promise<ActionResult> {
        return this.executeAction({
            type: 'build_settlement',
            params: { location },
        });
    }

    async buildCity(location: string): Promise<ActionResult> {
        return this.executeAction({
            type: 'build_city',
            params: { location },
        });
    }

    async trade(give: Record<string, number>, receive: Record<string, number>): Promise<ActionResult> {
        return this.executeAction({
            type: 'trade',
            params: { give, receive },
        });
    }

    async rollDice(): Promise<ActionResult> {
        return this.executeAction({
            type: 'roll_dice',
            params: {},
        });
    }

    // Get current game state
    getGameState(): GameState {
        return { ...this.gameState };
    }

    // Get agent status (balance, frozen, etc.)
    async getAgentStatus() {
        return this.client.getStatus();
    }
}

// =============================================================================
// EXAMPLE USAGE
// =============================================================================

/**
 * Example: Play a turn as an AI agent
 */
async function playTurn(agent: CatanAgent): Promise<void> {
    console.log('=== Starting Turn ===');

    // Check if we're frozen or have enough balance
    const status = await agent.getAgentStatus();
    console.log(`Agent balance: $${status.circleBalance} USDC`);

    if (status.frozen) {
        console.log('Agent is frozen! Cannot play.');
        return;
    }

    // Roll dice (costs $0.01)
    const rollResult = await agent.rollDice();
    console.log(`Dice roll: ${rollResult.message}`);

    // Try to build a road (costs $0.10)
    const roadResult = await agent.buildRoad('A1', 'A2');
    if (roadResult.success) {
        console.log(`Built road: ${roadResult.message}`);
    } else {
        console.log(`Failed to build road: ${roadResult.message}`);
    }

    // Try a trade (costs $0.05)
    const tradeResult = await agent.trade(
        { wood: 2 },
        { brick: 1 }
    );
    console.log(`Trade: ${tradeResult.message}`);

    console.log('=== Turn Complete ===');
}

/**
 * Example: Full game simulation
 */
async function runCatanDemo() {
    // Create agent client
    const agent = new CatanAgent(
        {
            agentId: 'catan-agent-red',
            apiKey: 'ak_your_api_key_here',
            gatewayBaseUrl: 'http://localhost:3000',
            backendBaseUrl: 'http://localhost:3000',
        },
        {
            currentPlayer: 'Red',
            resources: { wood: 3, brick: 3, sheep: 2, wheat: 1, ore: 0 },
            roads: [],
            settlements: ['B2'],
            cities: [],
        }
    );

    // Play a few turns
    for (let turn = 1; turn <= 3; turn++) {
        console.log(`\n--- Turn ${turn} ---\n`);
        await playTurn(agent);

        // Check balance after each turn
        const status = await agent.getAgentStatus();
        console.log(`Remaining balance: $${status.circleBalance}`);
    }
}

// Export for use as module
export { playTurn, runCatanDemo, CATAN_METER_ID, ACTION_PRICES };
