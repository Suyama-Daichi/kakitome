import type { SQLiteDatabase } from 'expo-sqlite';
import { parseHlc } from '../core/hlc';
import type { Entity, Json, Op } from '../core/ops';
import type { FieldState, Store } from '../core/store';
import { COLUMNS, TABLE } from './schema';

export class SqliteStore implements Store {
  constructor(private db: SQLiteDatabase) {}

  hasOp(id: string) {
    return !!this.db.getFirstSync('SELECT 1 FROM ops WHERE id = ?', id);
  }

  putOp(op: Op, uploaded: boolean) {
    this.db.runSync(
      'INSERT OR IGNORE INTO ops (id, hlc, device_id, payload, uploaded) VALUES (?, ?, ?, ?, ?)',
      op.id, op.hlc, parseHlc(op.hlc).device, JSON.stringify(op), uploaded ? 1 : 0,
    );
  }

  getOpByHlc(hlc: string) {
    const r = this.db.getFirstSync<{ payload: string }>('SELECT payload FROM ops WHERE hlc = ?', hlc);
    return r ? (JSON.parse(r.payload) as Op) : undefined;
  }

  getField(entity: Entity, id: string, field: string): FieldState | undefined {
    const c = this.db.getFirstSync<{ hlc: string; base: string | null }>(
      'SELECT hlc, base FROM field_clocks WHERE entity = ? AND entity_id = ? AND field = ?',
      entity, id, field,
    );
    if (!c) return undefined;
    let value: Json = null;
    if (COLUMNS[entity].includes(field)) {
      const r = this.db.getFirstSync<{ v: Json }>(`SELECT ${field} AS v FROM ${TABLE[entity]} WHERE id = ?`, id);
      value = r?.v ?? null;
    }
    return { value, hlc: c.hlc, base: c.base ?? undefined };
  }

  setField(entity: Entity, id: string, field: string, s: FieldState) {
    // 許可リスト外のフィールドは値を保存せず、クロックだけ進める（SQL インジェクション対策）
    if (COLUMNS[entity].includes(field)) {
      const t = TABLE[entity];
      this.db.runSync(`INSERT OR IGNORE INTO ${t} (id) VALUES (?)`, id);
      this.db.runSync(`UPDATE ${t} SET ${field} = ? WHERE id = ?`, s.value, id);
    }
    this.db.runSync(
      `INSERT INTO field_clocks (entity, entity_id, field, hlc, base) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (entity, entity_id, field) DO UPDATE SET hlc = excluded.hlc, base = excluded.base`,
      entity, id, field, s.hlc, s.base ?? null,
    );
  }
}
