/**
 * AgentBlinkPay Dashboard - Agents Page
 * 
 * Displays a table of all registered agents with their status,
 * balance, and controls for freeze/unfreeze.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface Agent {
    id: string;
    name: string;
    agentPubkey: string;
    circleBalance: string;
    frozen: boolean;
    createdAt: string;
}

// =============================================================================
// API CONFIGURATION
// =============================================================================

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// =============================================================================
// PAGE COMPONENT
// =============================================================================

export default function AgentsPage() {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
    const [recentPayments, setRecentPayments] = useState<any[]>([]);
    const [detailsLoading, setDetailsLoading] = useState(false);

    // Fetch agents on mount
    useEffect(() => {
        fetchAgents();
    }, []);

    async function fetchAgents() {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE_URL}/agents`);

            if (!response.ok) {
                throw new Error('Failed to fetch agents');
            }

            const data = await response.json();
            setAgents(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            // For demo, use mock data if API fails
            setAgents(getMockAgents());
        } finally {
            setLoading(false);
        }
    }

    async function toggleFreeze(agentId: string, currentlyFrozen: boolean) {
        const action = currentlyFrozen ? 'unfreeze' : 'freeze';

        // "Real" Frontend Control: Redirect to Dial.to to sign the Action
        // This leverages the "AgentBlinkPay" architecture where policy updates are Blinks.
        const actionUrl = `${API_BASE_URL}/api/actions/agent?agentId=${agentId}&action=${action}`;
        const dialUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(actionUrl)}`;

        // Open Dial.to in new tab to let user sign
        window.open(dialUrl, '_blank');

        // Optimistic update (optional, but good for UX)
        // In real app, we'd wait for webhook or poll, but for demo this is fine
        // as the user will see the success on Dial.to
    }

    async function openDetails(agent: Agent) {
        setSelectedAgent(agent);
        setDetailsLoading(true);
        setRecentPayments([]);

        try {
            const res = await fetch(`${API_BASE_URL}/agents/${agent.id}`);
            if (res.ok) {
                const data = await res.json();
                setRecentPayments(data.recentPayments || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setDetailsLoading(false);
        }
    }

    return (
        <div className="container">
            <Link href="/" className="back-link">
                ← Back to Dashboard
            </Link>

            <div className="page-header">
                <h1 className="page-title">🤖 Agents</h1>
                <button className="btn btn-primary" onClick={() => alert('Create agent form coming soon!')}>
                    + Create Agent
                </button>
            </div>

            {error && (
                <div style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid var(--danger)',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginBottom: '1rem'
                }}>
                    <p style={{ color: 'var(--danger)' }}>⚠️ {error}</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        Showing demo data. Start the backend to see real agents.
                    </p>
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                    <p>Loading agents...</p>
                </div>
            ) : (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Balance (USDC)</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {agents.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                        No agents found. Create your first agent to get started.
                                    </td>
                                </tr>
                            ) : (
                                agents.map((agent) => (
                                    <tr key={agent.id}>
                                        <td>
                                            <code style={{ fontSize: '0.875rem' }}>
                                                {agent.id.slice(0, 8)}...
                                            </code>
                                        </td>
                                        <td>{agent.name}</td>
                                        <td style={{ fontFamily: 'monospace' }}>
                                            ${agent.circleBalance}
                                        </td>
                                        <td>
                                            {agent.frozen ? (
                                                <span className="badge badge-danger">Frozen</span>
                                            ) : (
                                                <span className="badge badge-success">Active</span>
                                            )}
                                        </td>
                                        <td style={{ color: 'var(--text-muted)' }}>
                                            {new Date(agent.createdAt).toLocaleDateString()}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button
                                                    className={`btn btn-sm ${agent.frozen ? 'btn-success' : 'btn-danger'}`}
                                                    onClick={() => toggleFreeze(agent.id, agent.frozen)}
                                                >
                                                    {agent.frozen ? 'Unfreeze' : 'Freeze'}
                                                </button>
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => openDetails(agent)}
                                                >
                                                    Details
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Blink Info */}
            <div style={{
                marginTop: '2rem',
                padding: '1.5rem',
                background: 'var(--surface)',
                borderRadius: '12px',
                border: '1px solid var(--border)'
            }}>
                <h3 style={{ marginBottom: '0.75rem' }}>⚡ Control via Blinks</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    You can also freeze/unfreeze agents directly from X (Twitter) using Solana Actions.
                </p>
                <div className="code-block">
                    <code>
                        https://dial.to/action?action=solana-action%3A{API_BASE_URL}/api/actions/agent%3FagentId%3DAGENT_ID%26action%3Dfreeze
                    </code>
                </div>
            </div>

            {/* Details Modal (Simple inline implementation for demo) */}
            {selectedAgent && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                }}>
                    <div style={{
                        background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '600px', maxHeight: '80vh', overflowY: 'auto'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                            <h2>{selectedAgent.name} Details</h2>
                            <button className="btn btn-sm btn-secondary" onClick={() => setSelectedAgent(null)}>Close</button>
                        </div>

                        <h4>Recent Payments</h4>
                        {detailsLoading ? (
                            <p>Loading payments...</p>
                        ) : (
                            <table style={{ width: '100%', marginTop: '1rem', fontSize: '0.9rem' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left' }}>Time</th>
                                        <th style={{ textAlign: 'left' }}>Meter Output</th>
                                        <th style={{ textAlign: 'right' }}>Amount</th>
                                        <th style={{ textAlign: 'center' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentPayments.length === 0 ? (
                                        <tr><td colSpan={4} style={{ textAlign: 'center', padding: '1rem' }}>No recent payments.</td></tr>
                                    ) : (
                                        recentPayments.map(p => (
                                            <tr key={p.id}>
                                                <td>{new Date(p.createdAt).toLocaleTimeString()}</td>
                                                <td>{p.meterId.slice(0, 8)}...</td>
                                                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${p.amountFormatted}</td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span className={`badge badge-${p.status === 'succeeded' ? 'success' : 'warning'}`}>
                                                        {p.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}

                        <div style={{ marginTop: '2rem', background: '#f5f5f5', padding: '1rem', borderRadius: '8px' }}>
                            <code>ID: {selectedAgent.id}</code><br />
                            <code>Pubkey: {selectedAgent.agentPubkey}</code>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Add state for modal
function useAgentDetails() {
    // ... logic moved to main component state for simplicity
}

// =============================================================================
// MOCK DATA FOR DEMO
// =============================================================================

function getMockAgents(): Agent[] {
    return [
        {
            id: 'agent-001-abc123',
            name: 'Trading Bot Alpha',
            agentPubkey: 'ABc123...xyz789',
            circleBalance: '245.50',
            frozen: false,
            createdAt: '2024-01-15T10:30:00Z',
        },
        {
            id: 'agent-002-def456',
            name: 'Research Assistant',
            agentPubkey: 'DEf456...uvw012',
            circleBalance: '89.25',
            frozen: false,
            createdAt: '2024-01-18T14:45:00Z',
        },
        {
            id: 'agent-003-ghi789',
            name: 'Catan Player Red',
            agentPubkey: 'GHi789...rst345',
            circleBalance: '12.00',
            frozen: true,
            createdAt: '2024-01-20T09:00:00Z',
        },
    ];
}
