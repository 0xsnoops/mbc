/**
 * AgentBlinkPay Dashboard - Register API Page
 * 
 * Form for API providers to register their endpoints as paywalled meters.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface MeterFormData {
    name: string;
    upstreamUrl: string;
    httpMethod: string;
    pricePerCall: string;
    category: number;
    requiresZk: boolean;
}

interface CreateMeterResponse {
    id: string;
    meterPubkey: string;
    gatewayUrl: string;
    examples: {
        curl: string;
        sdk: string;
    };
}

// =============================================================================
// API CONFIGURATION
// =============================================================================

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const CATEGORIES = [
    { value: 1, label: 'AI/ML API' },
    { value: 2, label: 'Data Feed' },
    { value: 3, label: 'Tool/Utility' },
    { value: 4, label: 'Game Action' },
];

// =============================================================================
// PAGE COMPONENT
// =============================================================================

export default function ProvidersPage() {
    const [formData, setFormData] = useState<MeterFormData>({
        name: '',
        upstreamUrl: '',
        httpMethod: 'POST',
        pricePerCall: '0.05',
        category: 1,
        requiresZk: true,
    });

    const [result, setResult] = useState<CreateMeterResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        try {
            setLoading(true);
            setError(null);

            // Convert price from USDC to smallest units
            const priceInSmallestUnits = Math.floor(parseFloat(formData.pricePerCall) * 1_000_000);

            const response = await fetch(`${API_BASE_URL}/providers/meters`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: formData.name,
                    upstreamUrl: formData.upstreamUrl,
                    httpMethod: formData.httpMethod,
                    pricePerCall: priceInSmallestUnits,
                    category: formData.category,
                    requiresZk: formData.requiresZk,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create meter');
            }

            const data = await response.json();
            setResult(data);

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            // For demo, show mock result
            setResult(getMockResult(formData));
        } finally {
            setLoading(false);
        }
    }

    function handleInputChange(field: keyof MeterFormData, value: any) {
        setFormData({ ...formData, [field]: value });
    }

    function resetForm() {
        setFormData({
            name: '',
            upstreamUrl: '',
            httpMethod: 'POST',
            pricePerCall: '0.05',
            category: 1,
            requiresZk: true,
        });
        setResult(null);
        setError(null);
    }

    return (
        <div className="container">
            <Link href="/" className="back-link">
                ← Back to Dashboard
            </Link>

            <div className="page-header">
                <h1 className="page-title">🔌 Register API</h1>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                {/* Form */}
                <div style={{
                    background: 'var(--surface)',
                    padding: '1.5rem',
                    borderRadius: '12px',
                    border: '1px solid var(--border)'
                }}>
                    <h2 style={{ marginBottom: '1.5rem' }}>API Details</h2>

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label className="form-label">API Name</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="e.g., OpenAI Chat Completions"
                                value={formData.name}
                                onChange={(e) => handleInputChange('name', e.target.value)}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Upstream URL</label>
                            <input
                                type="url"
                                className="form-input"
                                placeholder="https://api.example.com/v1/endpoint"
                                value={formData.upstreamUrl}
                                onChange={(e) => handleInputChange('upstreamUrl', e.target.value)}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">HTTP Method</label>
                            <select
                                className="form-input form-select"
                                value={formData.httpMethod}
                                onChange={(e) => handleInputChange('httpMethod', e.target.value)}
                            >
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                                <option value="PUT">PUT</option>
                                <option value="PATCH">PATCH</option>
                                <option value="DELETE">DELETE</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Price per Call (USDC)</label>
                            <input
                                type="number"
                                className="form-input"
                                placeholder="0.05"
                                step="0.01"
                                min="0"
                                value={formData.pricePerCall}
                                onChange={(e) => handleInputChange('pricePerCall', e.target.value)}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Category</label>
                            <select
                                className="form-input form-select"
                                value={formData.category}
                                onChange={(e) => handleInputChange('category', parseInt(e.target.value))}
                            >
                                {CATEGORIES.map((cat) => (
                                    <option key={cat.value} value={cat.value}>
                                        {cat.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-checkbox">
                                <input
                                    type="checkbox"
                                    checked={formData.requiresZk}
                                    onChange={(e) => handleInputChange('requiresZk', e.target.checked)}
                                />
                                Require ZK policy verification
                            </label>
                            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                                When enabled, agents must provide a ZK proof that their payment complies with their policy.
                            </p>
                        </div>

                        {error && (
                            <div style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                padding: '0.75rem',
                                borderRadius: '8px',
                                marginBottom: '1rem',
                                color: 'var(--danger)'
                            }}>
                                ⚠️ {error} (showing demo result)
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Creating...' : 'Create Meter'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={resetForm}>
                                Reset
                            </button>
                        </div>
                    </form>
                </div>

                {/* Result */}
                <div style={{
                    background: 'var(--surface)',
                    padding: '1.5rem',
                    borderRadius: '12px',
                    border: '1px solid var(--border)'
                }}>
                    <h2 style={{ marginBottom: '1.5rem' }}>Integration</h2>

                    {result ? (
                        <div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
                                    Gateway URL
                                </h3>
                                <div className="code-block">
                                    <code>{result.gatewayUrl}</code>
                                </div>
                            </div>

                            <div style={{ marginBottom: '1.5rem' }}>
                                <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
                                    cURL Example
                                </h3>
                                <div className="code-block" style={{ whiteSpace: 'pre-wrap' }}>
                                    <code>{result.examples.curl}</code>
                                </div>
                            </div>

                            <div>
                                <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
                                    SDK Example
                                </h3>
                                <div className="code-block" style={{ whiteSpace: 'pre-wrap' }}>
                                    <code>{result.examples.sdk}</code>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            textAlign: 'center',
                            padding: '3rem',
                            color: 'var(--text-muted)'
                        }}>
                            <p style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</p>
                            <p>Fill out the form to see integration examples</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// =============================================================================
// MOCK DATA FOR DEMO
// =============================================================================

function getMockResult(formData: MeterFormData): CreateMeterResponse {
    const meterId = 'meter-' + Math.random().toString(36).slice(2, 10);
    const gatewayUrl = `${API_BASE_URL}/m/${meterId}`;

    return {
        id: meterId,
        meterPubkey: 'ABC123...XYZ789',
        gatewayUrl,
        examples: {
            curl: `curl -X ${formData.httpMethod} \\
  -H "x-agent-id: YOUR_AGENT_ID" \\
  -H "x-agent-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"your": "data"}' \\
  ${gatewayUrl}/your/endpoint`,
            sdk: `import { AgentClient } from '@agentblinkpay/sdk';

const agent = new AgentClient({
  agentId: 'YOUR_AGENT_ID',
  apiKey: 'YOUR_API_KEY',
  gatewayBaseUrl: '${API_BASE_URL}',
  backendBaseUrl: '${API_BASE_URL}',
});

const response = await agent.callPaywalledApi(
  '${meterId}',
  '/your/endpoint',
  {
    method: '${formData.httpMethod}',
    body: JSON.stringify({ your: 'data' }),
  }
);
const data = await response.json();`,
        },
    };
}
