import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'AgentBlinkPay Dashboard',
    description: 'Solana-based spending brain for AI agents with ZK-enforced policies',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
