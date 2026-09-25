import type { PerpetualExecutionResult, SpotExecutionResult } from '@warren/execution-contract';

import type { Sqlite } from '../db.js';

type ExecutionState = 'review' | 'submitted' | 'confirmed' | 'failed' | 'unknown';

type BaseExecutionIntent = {
  executionId: string;
  userId: string;
  walletAddress: string;
  assetId: string;
  instrumentId: string;
  companyName: string;
  symbol: string;
  direction: 'buy' | 'sell' | 'long' | 'short';
  unsignedTransaction: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  state: ExecutionState;
  idempotencyKey?: string;
  signature?: string;
  valueUsd: number | null;
  quantity: string | null;
  failureMessage?: string;
};

export type SpotExecutionIntent = BaseExecutionIntent & {
  kind: 'spot';
  direction: 'buy' | 'sell';
  providerRequestId: string;
  lastValidBlockHeight: number | null;
  result?: SpotExecutionResult;
};

export type PerpetualExecutionIntent = BaseExecutionIntent & {
  kind: 'perpetual';
  direction: 'long' | 'short';
  result?: PerpetualExecutionResult;
};

export type ExecutionIntent = SpotExecutionIntent | PerpetualExecutionIntent;

export interface ExecutionIntentStore {
  get(executionId: string): ExecutionIntent | undefined;
  save(intent: ExecutionIntent): void;
  update(intent: ExecutionIntent): void;
  list(input: { userId: string; walletAddresses: readonly string[]; limit: number }): ExecutionIntent[];
  deleteExpired(before: string): void;
}

export class MemoryExecutionIntentStore implements ExecutionIntentStore {
  private readonly intents = new Map<string, ExecutionIntent>();

  get(executionId: string) {
    return this.intents.get(executionId);
  }

  save(intent: ExecutionIntent) {
    if (this.intents.has(intent.executionId)) throw new Error('Execution intent already exists.');
    this.intents.set(intent.executionId, structuredClone(intent));
  }

  update(intent: ExecutionIntent) {
    if (!this.intents.has(intent.executionId)) throw new Error('Execution intent does not exist.');
    this.intents.set(intent.executionId, structuredClone(intent));
  }

  list(input: { userId: string; walletAddresses: readonly string[]; limit: number }) {
    const wallets = new Set(input.walletAddresses);
    return [...this.intents.values()]
      .filter((intent) => intent.userId === input.userId && wallets.has(intent.walletAddress))
      .sort(compareIntentActivity)
      .slice(0, input.limit)
      .map((intent) => structuredClone(intent));
  }

  deleteExpired(before: string) {
    for (const [key, intent] of this.intents) {
      if (intent.expiresAt <= before && intent.state === 'review') this.intents.delete(key);
    }
  }
}

export class SqliteExecutionIntentStore implements ExecutionIntentStore {
  constructor(private readonly db: Sqlite) {}

  get(executionId: string) {
    const row = this.db.prepare('SELECT payload_json FROM execution_intents WHERE execution_id=?').get(executionId) as { payload_json: string } | undefined;
    return row ? parseIntent(row.payload_json) : undefined;
  }

  save(intent: ExecutionIntent) {
    this.db.prepare(`
      INSERT INTO execution_intents(
        execution_id,user_id,wallet_address,product,state,signature,created_at,updated_at,expires_at,payload_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(...intentColumns(intent));
  }

  update(intent: ExecutionIntent) {
    const result = this.db.prepare(`
      UPDATE execution_intents
      SET user_id=?,wallet_address=?,product=?,state=?,signature=?,created_at=?,updated_at=?,expires_at=?,payload_json=?
      WHERE execution_id=?
    `).run(
      intent.userId,
      intent.walletAddress,
      intent.kind,
      intent.state,
      intent.signature ?? null,
      intent.createdAt,
      intent.updatedAt,
      intent.expiresAt,
      JSON.stringify(intent),
      intent.executionId,
    );
    if (result.changes !== 1) throw new Error('Execution intent does not exist.');
  }

  list(input: { userId: string; walletAddresses: readonly string[]; limit: number }) {
    if (!input.walletAddresses.length) return [];
    const walletPlaceholders = input.walletAddresses.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT payload_json FROM execution_intents
      WHERE user_id=? AND wallet_address IN (${walletPlaceholders})
      ORDER BY updated_at DESC, execution_id DESC
      LIMIT ?
    `).all(input.userId, ...input.walletAddresses, input.limit) as { payload_json: string }[];
    return rows.map((row) => parseIntent(row.payload_json));
  }

  deleteExpired(before: string) {
    this.db.prepare("DELETE FROM execution_intents WHERE state='review' AND expires_at<=?").run(before);
  }
}

function intentColumns(intent: ExecutionIntent) {
  return [
    intent.executionId,
    intent.userId,
    intent.walletAddress,
    intent.kind,
    intent.state,
    intent.signature ?? null,
    intent.createdAt,
    intent.updatedAt,
    intent.expiresAt,
    JSON.stringify(intent),
  ];
}

function parseIntent(value: string): ExecutionIntent {
  const parsed = JSON.parse(value) as ExecutionIntent;
  if (!parsed || typeof parsed !== 'object' || !parsed.executionId || !['spot', 'perpetual'].includes(parsed.kind)) {
    throw new Error('Stored execution intent is invalid.');
  }
  return parsed;
}

function compareIntentActivity(left: ExecutionIntent, right: ExecutionIntent) {
  return right.updatedAt.localeCompare(left.updatedAt) || right.executionId.localeCompare(left.executionId);
}
