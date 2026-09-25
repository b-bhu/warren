import type { Sqlite } from '../db.js';
import type { PhoenixRegistrationIntent, PhoenixRegistrationIntentStore } from './registration-types.js';

export class MemoryPhoenixRegistrationIntentStore implements PhoenixRegistrationIntentStore {
  private readonly intents = new Map<string, PhoenixRegistrationIntent>();

  get(registrationId: string) {
    const intent = this.intents.get(registrationId);
    return intent ? structuredClone(intent) : undefined;
  }

  save(intent: PhoenixRegistrationIntent) {
    if (this.intents.has(intent.registrationId)) throw new Error('Phoenix registration intent already exists.');
    this.intents.set(intent.registrationId, structuredClone(intent));
  }

  update(intent: PhoenixRegistrationIntent) {
    if (!this.intents.has(intent.registrationId)) throw new Error('Phoenix registration intent does not exist.');
    this.intents.set(intent.registrationId, structuredClone(intent));
  }

  deleteExpired(before: string) {
    for (const [key, intent] of this.intents) {
      if (intent.state === 'review' && intent.expiresAt <= before) this.intents.delete(key);
    }
  }
}

export class SqlitePhoenixRegistrationIntentStore implements PhoenixRegistrationIntentStore {
  constructor(private readonly db: Sqlite) {}

  get(registrationId: string) {
    const row = this.db.prepare('SELECT payload_json FROM phoenix_registration_intents WHERE registration_id=?')
      .get(registrationId) as { payload_json: string } | undefined;
    return row ? parseIntent(row.payload_json) : undefined;
  }

  save(intent: PhoenixRegistrationIntent) {
    this.db.prepare(`
      INSERT INTO phoenix_registration_intents(
        registration_id,user_id,wallet_address,mode,state,signature,created_at,updated_at,expires_at,payload_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(...intentColumns(intent));
  }

  update(intent: PhoenixRegistrationIntent) {
    const result = this.db.prepare(`
      UPDATE phoenix_registration_intents
      SET user_id=?,wallet_address=?,mode=?,state=?,signature=?,created_at=?,updated_at=?,expires_at=?,payload_json=?
      WHERE registration_id=?
    `).run(
      intent.userId,
      intent.walletAddress,
      intent.mode,
      intent.state,
      intent.signature ?? null,
      intent.createdAt,
      intent.updatedAt,
      intent.expiresAt,
      JSON.stringify(intent),
      intent.registrationId,
    );
    if (result.changes !== 1) throw new Error('Phoenix registration intent does not exist.');
  }

  deleteExpired(before: string) {
    this.db.prepare("DELETE FROM phoenix_registration_intents WHERE state='review' AND expires_at<=?").run(before);
  }
}

function intentColumns(intent: PhoenixRegistrationIntent) {
  return [
    intent.registrationId,
    intent.userId,
    intent.walletAddress,
    intent.mode,
    intent.state,
    intent.signature ?? null,
    intent.createdAt,
    intent.updatedAt,
    intent.expiresAt,
    JSON.stringify(intent),
  ];
}

function parseIntent(value: string): PhoenixRegistrationIntent {
  const parsed = JSON.parse(value) as PhoenixRegistrationIntent;
  if (!parsed || typeof parsed !== 'object' || !parsed.registrationId || !['non_referral', 'referral'].includes(parsed.mode)) {
    throw new Error('Stored Phoenix registration intent is invalid.');
  }
  return parsed;
}
