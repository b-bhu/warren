import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'com.warren.saved-companies.v1';
const MAX_SAVED_COMPANIES = 200;
const assetIdPattern = /^[a-z0-9][a-z0-9:_-]{0,127}$/;
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'com.warren.saved-companies.v1',
};

export type SavedCompanyRecord = { assetId: string; savedAt: string };
type SavedCompaniesSnapshot = {
  hydrated: boolean;
  records: readonly SavedCompanyRecord[];
  error?: string;
};

let snapshot: SavedCompaniesSnapshot = { hydrated: false, records: [] };
let hydration: Promise<void> | undefined;
const listeners = new Set<() => void>();

export function useSavedCompanies() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const assetIds = useMemo(() => current.records.map((record) => record.assetId), [current.records]);
  useEffect(() => { void hydrateSavedCompanies(); }, []);
  return {
    ...current,
    assetIds,
    isSaved: (assetId: string) => current.records.some((record) => record.assetId === assetId),
    setSaved: (assetId: string, saved: boolean) => setCompanySaved(assetId, saved),
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function publish(next: SavedCompaniesSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function hydrateSavedCompanies() {
  if (snapshot.hydrated) return;
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const raw = Platform.OS === 'web'
        ? globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
        : await SecureStore.getItemAsync(STORAGE_KEY, secureStoreOptions);
      publish({ hydrated: true, records: parseRecords(raw) });
    } catch {
      publish({
        hydrated: true,
        records: [],
        error: 'Saved companies could not be loaded on this device.',
      });
    } finally {
      hydration = undefined;
    }
  })();
  return hydration;
}

async function setCompanySaved(assetId: string, saved: boolean) {
  if (!assetIdPattern.test(assetId)) throw new Error('This company cannot be saved.');
  await hydrateSavedCompanies();
  const previous = snapshot;
  const withoutAsset = previous.records.filter((record) => record.assetId !== assetId);
  const records = saved
    ? [{ assetId, savedAt: new Date().toISOString() }, ...withoutAsset].slice(0, MAX_SAVED_COMPANIES)
    : withoutAsset;
  publish({ hydrated: true, records });
  try {
    const serialized = JSON.stringify(records);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(STORAGE_KEY, serialized);
    else await SecureStore.setItemAsync(STORAGE_KEY, serialized, secureStoreOptions);
  } catch {
    publish({ ...previous, error: 'The saved-company change was not stored. Try again.' });
    throw new Error('The saved-company change was not stored. Try again.');
  }
}

function parseRecords(raw: string | null): SavedCompanyRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const records: SavedCompanyRecord[] = [];
    const seen = new Set<string>();
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') continue;
      const assetId = (candidate as { assetId?: unknown }).assetId;
      const savedAt = (candidate as { savedAt?: unknown }).savedAt;
      if (typeof assetId !== 'string' || !assetIdPattern.test(assetId) || typeof savedAt !== 'string') continue;
      if (Number.isNaN(new Date(savedAt).getTime()) || seen.has(assetId)) continue;
      seen.add(assetId);
      records.push({ assetId, savedAt });
      if (records.length === MAX_SAVED_COMPANIES) break;
    }
    return records;
  } catch {
    return [];
  }
}
