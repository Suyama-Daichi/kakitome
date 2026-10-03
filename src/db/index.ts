import * as Crypto from 'expo-crypto';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { v7 as uuidv7 } from 'uuid';
import { createClock, type Clock } from '../core/hlc';
import type { Ctx } from '../core/merge';
import { SCHEMA } from './schema';
import { SqliteStore } from './sqlite-store';

let db: SQLiteDatabase | undefined;
export function getDb() {
  if (!db) {
    db = openDatabaseSync('kakitome.db');
    db.execSync('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;'); // アプリとウィジェットが同時に書く
    db.execSync(SCHEMA);
  }
  return db;
}

const getState = (db: SQLiteDatabase, key: string) =>
  db.getFirstSync<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', key)?.value;
const setState = (db: SQLiteDatabase, key: string, value: string) =>
  db.runSync('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', key, value);

/** ウィジェットは都度ヘッドレスで起動し得るので、端末IDとHLCの最終値は DB に永続化する */
function persistentClock(db: SQLiteDatabase): Clock {
  let device = getState(db, 'device_id');
  if (!device) {
    device = `dev-${Array.from(Crypto.getRandomBytes(4), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    setState(db, 'device_id', device);
  }
  const c = createClock(device, Date.now, getState(db, 'hlc_last'));
  const save = () => setState(db, 'hlc_last', c.last());
  return {
    now: () => { const h = c.now(); save(); return h; },
    receive: (r) => { c.receive(r); save(); },
    last: c.last,
  };
}

/** 同期コアを呼ぶための Ctx。変更は必ず tx 内で行う */
export function openCore() {
  const d = getDb();
  const ctx: Ctx = {
    store: new SqliteStore(d),
    clock: persistentClock(d),
    newId: () => uuidv7({ random: Crypto.getRandomBytes(16) }),
  };
  const tx = <T,>(fn: () => T): T => {
    let r!: T;
    d.withTransactionSync(() => { r = fn(); });
    return r;
  };
  return { ctx, tx };
}
