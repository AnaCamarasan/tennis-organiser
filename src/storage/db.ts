import type { Player, ConfirmedRound, RoundDraft } from '../logic/types';
export type DraftMode = 'new' | 'correction';
export interface Session {
  id: string;
  startedAt: string;
  attendeeIds: string[];
  courts: number;
  rounds: ConfirmedRound[];
  draft: RoundDraft | null;
  draftMode: DraftMode;
  correctionIndex: number | null;
  nextSeed: number;
}
export interface AppData { players: Player[]; session: Session | null }
const DB_NAME = 'baseline-tennis-v1';
const STORE = 'state';
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function readData(): Promise<AppData> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get('app');
    request.onsuccess = () => resolve(request.result ?? { players: [], session: null });
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function writeData(data: AppData): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(data, 'app');
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
