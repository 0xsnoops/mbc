/**
 * AgentBlinkPay Dashboard - Home Page
 * 
 * Overview dashboard showing system status and quick links.
 */

import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
    return (
        <main className={styles.main}>
            <div className={styles.header}>
                <h1 className={styles.title}>
                    <span className={styles.logo}>⚡</span> AgentBlinkPay
                </h1>
                <p className={styles.subtitle}>
                    Solana-based spending brain for AI agents with ZK-enforced policies
                </p>
            </div>

            <div className={styles.grid}>
                <Link href="/agents" className={styles.card}>
                    <h2>🤖 Agents</h2>
                    <p>View and manage your AI agents. Monitor balances, spending, and freeze status.</p>
                </Link>

                <Link href="/providers" className={styles.card}>
                    <h2>🔌 Register API</h2>
                    <p>Register your API as a paywalled endpoint. Set pricing and get a gateway URL.</p>
                </Link>

                <div className={styles.card}>
                    <h2>📊 Analytics</h2>
                    <p>Coming soon: View payment analytics, usage patterns, and revenue metrics.</p>
                </div>

                <div className={styles.card}>
                    <h2>📚 Documentation</h2>
                    <p>Learn how to integrate AgentBlinkPay with your agents and APIs.</p>
                </div>
            </div>

            <section className={styles.features}>
                <h2>Core Features</h2>
                <div className={styles.featureGrid}>
                    <div className={styles.feature}>
                        <span className={styles.featureIcon}>🔐</span>
                        <h3>ZK-Enforced Policies</h3>
                        <p>Prove payment compliance without revealing full policy details using Noir circuits.</p>
                    </div>
                    <div className={styles.feature}>
                        <span className={styles.featureIcon}>💳</span>
                        <h3>Circle USDC</h3>
                        <p>Programmable wallets with gasless transactions via Circle&apos;s infrastructure.</p>
                    </div>
                    <div className={styles.feature}>
                        <span className={styles.featureIcon}>⚡</span>
                        <h3>Blinks Control</h3>
                        <p>Freeze, unfreeze, and top up agents directly from social media via Solana Actions.</p>
                    </div>
                    <div className={styles.feature}>
                        <span className={styles.featureIcon}>🌐</span>
                        <h3>x402 Gateway</h3>
                        <p>Turn any HTTP API into a pay-per-call endpoint with one simple registration.</p>
                    </div>
                </div>
            </section>
        </main>
    );
}
