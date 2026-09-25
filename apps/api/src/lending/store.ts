import type { LendingActionKind, LendingActionState, LendingStepKind, LendingStepState } from '@warren/lending-contract';
import type { Sqlite } from '../db.js';

export type LendingStep = {
  stepId: string; sequence: number; kind: LendingStepKind; state: LendingStepState;
  unsignedTransaction: string; expiresAt: string; lastValidBlockHeight: number;
  amountRaw: string; amount: string; displayAmount: string; symbol: string; decimals: number;
  feeEstimateLamports: string | null;
  rentEstimateLamports: string | null;
  simulation: { ok: boolean; unitsConsumed: number | null; logs: string[]; error: string | null };
  signature?: string; idempotencyKey?: string; submissionStartedAt?: string;
  updatedAt: string; message?: string;
};
export type LendingAction = {
  actionId: string; userId: string; walletAddress: string; idempotencyKey: string;
  action: LendingActionKind; assetId: string; state: LendingActionState;
  amountRaw: string; secondaryAmountRaw?: string;
  steps: LendingStep[]; createdAt: string; updatedAt: string;
};
export interface LendingActionStore {
  get(actionId: string): LendingAction | undefined;
  getByIdempotency(userId: string, key: string): LendingAction | undefined;
  list(input: { userId: string; walletAddress: string; limit: number }): LendingAction[];
  save(action: LendingAction): void;
  update(action: LendingAction): void;
}

export class MemoryLendingActionStore implements LendingActionStore {
  private readonly rows = new Map<string, LendingAction>();
  get(id: string) { const row = this.rows.get(id); return row ? structuredClone(row) : undefined; }
  getByIdempotency(userId: string, key: string) { const row = [...this.rows.values()].find((item) => item.userId === userId && item.idempotencyKey === key); return row ? structuredClone(row) : undefined; }
  list(input: { userId: string; walletAddress: string; limit: number }) {
    return [...this.rows.values()].filter((item) => item.userId === input.userId && item.walletAddress === input.walletAddress)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, input.limit).map((item) => structuredClone(item));
  }
  save(action: LendingAction) {
    if (this.getByIdempotency(action.userId, action.idempotencyKey)) throw new Error('Lending idempotency key already exists.');
    this.rows.set(action.actionId, structuredClone(action));
  }
  update(action: LendingAction) {
    if (!this.rows.has(action.actionId)) throw new Error('Lending action does not exist.');
    this.rows.set(action.actionId, structuredClone(action));
  }
}

export class SqliteLendingActionStore implements LendingActionStore {
  constructor(private readonly db: Sqlite) {}
  get(actionId: string) {
    const row = this.db.prepare('SELECT payload_json FROM kamino_lending_actions WHERE action_id=?').get(actionId) as { payload_json: string } | undefined;
    return row ? parseAction(row.payload_json) : undefined;
  }
  getByIdempotency(userId: string, key: string) {
    const row = this.db.prepare('SELECT payload_json FROM kamino_lending_actions WHERE user_id=? AND idempotency_key=?').get(userId, key) as { payload_json: string } | undefined;
    return row ? parseAction(row.payload_json) : undefined;
  }
  list(input: { userId: string; walletAddress: string; limit: number }) {
    const rows = this.db.prepare(`SELECT payload_json FROM kamino_lending_actions WHERE user_id=? AND wallet_address=? ORDER BY updated_at DESC, action_id DESC LIMIT ?`)
      .all(input.userId, input.walletAddress, input.limit) as { payload_json: string }[];
    return rows.map((row) => parseAction(row.payload_json));
  }
  save(action: LendingAction) {
    this.db.prepare(`INSERT INTO kamino_lending_actions(action_id,user_id,wallet_address,idempotency_key,state,created_at,updated_at,payload_json) VALUES(?,?,?,?,?,?,?,?)`)
      .run(action.actionId, action.userId, action.walletAddress, action.idempotencyKey, action.state, action.createdAt, action.updatedAt, JSON.stringify(action));
  }
  update(action: LendingAction) {
    const result = this.db.prepare(`UPDATE kamino_lending_actions SET state=?,updated_at=?,payload_json=? WHERE action_id=? AND user_id=?`)
      .run(action.state, action.updatedAt, JSON.stringify(action), action.actionId, action.userId);
    if (result.changes !== 1) throw new Error('Lending action does not exist.');
  }
}

function parseAction(raw: string): LendingAction {
  const action = JSON.parse(raw) as LendingAction;
  if (!action || typeof action !== 'object' || !action.actionId || !action.userId || !action.walletAddress || !Array.isArray(action.steps)) {
    throw new Error('Stored Kamino lending action is invalid.');
  }
  return action;
}
