import type { Sqlite } from '../db.js';

export interface PortfolioSnapshotStore {
  save(input: { userId: string; walletAddress: string; capturedAt: string; netEquityUsd: number }): void;
  latestBefore(input: { userId: string; walletAddress: string; before: string }): { capturedAt: string; netEquityUsd: number } | undefined;
}

export class MemoryPortfolioSnapshotStore implements PortfolioSnapshotStore {
  private readonly rows = new Map<string, { userId: string; walletAddress: string; capturedAt: string; netEquityUsd: number }>();

  save(input: { userId: string; walletAddress: string; capturedAt: string; netEquityUsd: number }) {
    this.rows.set(key(input.userId, input.walletAddress, hourBucket(input.capturedAt)), { ...input });
  }

  latestBefore(input: { userId: string; walletAddress: string; before: string }) {
    return [...this.rows.values()]
      .filter((row) => row.userId === input.userId && row.walletAddress === input.walletAddress && row.capturedAt < input.before)
      .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))[0];
  }
}

export class SqlitePortfolioSnapshotStore implements PortfolioSnapshotStore {
  constructor(private readonly db: Sqlite) {}

  save(input: { userId: string; walletAddress: string; capturedAt: string; netEquityUsd: number }) {
    this.db.prepare(`
      INSERT INTO portfolio_snapshots(user_id,wallet_address,hour_bucket,captured_at,net_equity_usd)
      VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,wallet_address,hour_bucket)
      DO UPDATE SET captured_at=excluded.captured_at, net_equity_usd=excluded.net_equity_usd
    `).run(input.userId, input.walletAddress, hourBucket(input.capturedAt), input.capturedAt, input.netEquityUsd);
  }

  latestBefore(input: { userId: string; walletAddress: string; before: string }) {
    const row = this.db.prepare(`
      SELECT captured_at, net_equity_usd FROM portfolio_snapshots
      WHERE user_id=? AND wallet_address=? AND captured_at<?
      ORDER BY captured_at DESC LIMIT 1
    `).get(input.userId, input.walletAddress, input.before) as { captured_at: string; net_equity_usd: number } | undefined;
    return row ? { capturedAt: row.captured_at, netEquityUsd: row.net_equity_usd } : undefined;
  }
}

function hourBucket(value: string) {
  return value.slice(0, 13);
}

function key(userId: string, walletAddress: string, bucket: string) {
  return `${userId}:${walletAddress}:${bucket}`;
}
