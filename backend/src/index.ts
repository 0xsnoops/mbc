/**
 * AgentBlinkPay Backend - Main Entry Point
 * 
 * Express server providing:
 * - x402 HTTP gateway for paywalled APIs
 * - REST API for agents and providers
 * - Solana Actions endpoints for Blinks
 * - Solana event listener for MeterPaid -> Circle transfers
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { initializeDatabase } from './db';
import { startListener } from './services/solanaListener';
import x402Routes from './routes/x402';
import agentRoutes from './routes/agents';
import providerRoutes from './routes/providers';
import actionsRoutes from './routes/actions';

// Load environment variables
dotenv.config();

// =============================================================================
// VALIDATION
// =============================================================================
const REQUIRED_ENV = [
    'CIRCLE_API_KEY',
    'PAYER_SECRET_KEY',
    'CIRCLE_USDC_TOKEN_ID',
    'PROGRAM_ID' // Likely needed too
];

const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
    console.error(`[CRITICAL] Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please update your .env file.');
    process.exit(1);
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

// =============================================================================
// APP SETUP
// =============================================================================

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// =============================================================================
// ROUTES
// =============================================================================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'AgentBlinkPay Backend' });
});

// x402 Gateway (catches all /m/:meterId/* requests)
app.use(x402Routes);

// REST API
app.use(agentRoutes);
app.use(providerRoutes);

// Solana Actions / Blinks
app.use(actionsRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// =============================================================================
// STARTUP
// =============================================================================

async function main() {
    console.log('==========================================================');
    console.log('AgentBlinkPay Backend Starting...');
    console.log('==========================================================');

    // Initialize database
    console.log('Initializing database...');
    initializeDatabase();

    // Start Solana event listener (in background)
    console.log('Starting Solana event listener...');
    startListener().catch((err) => {
        console.error('Failed to start Solana listener:', err);
        // Continue running - listener can be restarted later
    });

    // Start HTTP server
    app.listen(PORT, HOST, () => {
        console.log('==========================================================');
        console.log(`Server running at http://${HOST}:${PORT}`);
        console.log('');
        console.log('Endpoints:');
        console.log(`  Health:          GET  http://${HOST}:${PORT}/health`);
        console.log(`  x402 Gateway:    ALL  http://${HOST}:${PORT}/m/:meterId/*`);
        console.log(`  Create Agent:    POST http://${HOST}:${PORT}/agents`);
        console.log(`  Get Agent:       GET  http://${HOST}:${PORT}/agents/:id`);
        console.log(`  Agent Pay:       POST http://${HOST}:${PORT}/agents/:id/pay`);
        console.log(`  Register Meter:  POST http://${HOST}:${PORT}/providers/meters`);
        console.log(`  List Meters:     GET  http://${HOST}:${PORT}/providers/meters`);
        console.log(`  Actions (Blink): GET  http://${HOST}:${PORT}/api/actions/agent`);
        console.log('==========================================================');
    });
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
