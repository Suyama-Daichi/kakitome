import type { Entity, Json, Op } from './ops';

export interface FieldState {
  value: Json;
  /** この値を書いた op の HLC（field_clocks.hlc） */
  hlc: string;
  /** この値が編集時に見ていた HLC（field_clocks.base） */
  base?: string;
}

/**
 * 同期コアが必要とする永続層。同期 API なのはヘッドレス JS でも素直に呼べるようにするため。
 * 本番実装は src/db/（expo-sqlite）、テストでは MemoryStore。
 */
export interface Store {
  hasOp(id: string): boolean;
  /** uploaded=false は Drive への送信待ち */
  putOp(op: Op, uploaded: boolean): void;
  getOpByHlc(hlc: string): Op | undefined;
  getField(entity: Entity, entityId: string, field: string): FieldState | undefined;
  setField(entity: Entity, entityId: string, field: string, state: FieldState): void;
}

export class MemoryStore implements Store {
  ops = new Map<string, { op: Op; uploaded: boolean }>();
  private byHlc = new Map<string, Op>();
  private fields = new Map<string, FieldState>();

  private key = (e: Entity, id: string, f: string) => `${e}\0${id}\0${f}`;

  hasOp = (id: string) => this.ops.has(id);
  putOp(op: Op, uploaded: boolean) {
    this.ops.set(op.id, { op, uploaded });
    this.byHlc.set(op.hlc, op);
  }
  getOpByHlc = (hlc: string) => this.byHlc.get(hlc);
  getField = (e: Entity, id: string, f: string) => this.fields.get(this.key(e, id, f));
  setField(e: Entity, id: string, f: string, state: FieldState) {
    this.fields.set(this.key(e, id, f), state);
  }

  /** entity → id → field → value。レプリカ間の状態比較用 */
  snapshot(): Record<string, Record<string, Record<string, Json>>> {
    const out: Record<string, Record<string, Record<string, Json>>> = {};
    for (const [k, s] of this.fields) {
      const [e, id, f] = k.split('\0');
      ((out[e] ??= {})[id] ??= {})[f] = s.value;
    }
    return out;
  }
}
