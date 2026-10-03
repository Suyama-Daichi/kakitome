// op の圧縮（設計 §6.4）。各端末は自分の op だけを、フィールドごとに「最新の値」へまとめる。
// 自端末が後で上書きした値は捨てて構わない（データは失われない）。
import { parseHlc } from './hlc';
import { ENTITIES, isPrimitive, type Entity, type Json, type Op } from './ops';

export interface SnapshotEntry {
  entity: Entity;
  entityId: string;
  field: string;
  value: Json;
  /** この値を書いた（自端末の最新の）op の HLC */
  hlc: string;
  /**
   * そのフィールドを最初に編集したとき自端末が見ていた HLC。最初の op が作成（base なし）なら、その op 自身の HLC。
   * どちらも自端末が実際に見ていた値なので、「見ていない値を見たことにする」ことは無い（競合の見逃しは増えない）。
   * base が無いと競合検出の対象外になり、同時編集がサイレントに負けるので、必ず入れる。
   * 作成した他端末の値との連続編集を、競合と誤判定しないためにも使う。
   */
  base: string;
}

export interface Snapshot {
  v: 1;
  device: string;
  /** このスナップショットが含む最後の HLC */
  upTo: string;
  entries: SnapshotEntry[];
}


/** `ops` のうち、device 自身が作ったもの（導出された競合コピーの op や他端末の op は除く）をまとめる */
export function buildSnapshot(device: string, ops: Op[]): Snapshot {
  const latest = new Map<string, Omit<SnapshotEntry, 'base'>>();
  const first = new Map<string, { hlc: string; base: string }>();
  let upTo = '';
  for (const op of [...ops].sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0))) {
    if (parseHlc(op.hlc).device !== device) continue;
    if (op.hlc > upTo) upTo = op.hlc;
    for (const [field, value] of Object.entries(op.fields)) {
      const key = JSON.stringify([op.entity, op.entityId, field]);
      if (!first.has(key)) first.set(key, { hlc: op.hlc, base: op.base[field] ?? op.hlc });
      latest.set(key, { entity: op.entity, entityId: op.entityId, field, value, hlc: op.hlc });
    }
  }
  const entries = [...latest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, e]) => ({ ...e, base: first.get(key)!.base }));
  return { v: 1, device, upTo, entries };
}

/** 受信側: エントリを 1 つずつ疑似 op に戻す。ID は内容から決まる固定値なので、再受信しても冪等 */
export function snapshotToOps(s: Snapshot): Op[] {
  return s.entries.map((e) => ({
    id: `snap:${e.hlc}:${e.entity}:${e.entityId}:${e.field}`,
    hlc: e.hlc,
    entity: e.entity,
    entityId: e.entityId,
    fields: { [e.field]: e.value },
    base: { [e.field]: e.base },
  }));
}

/** Drive から読んだ内容を検証する。形が不正なら null（1 ファイルの破損で同期全体を止めない） */
export function parseSnapshot(text: string): Snapshot | null {
  try {
    const s = JSON.parse(text);
    if (s?.v !== 1 || typeof s.device !== 'string' || typeof s.upTo !== 'string' || !Array.isArray(s.entries)) return null;
    for (const e of s.entries) {
      const ok =
        ENTITIES.includes(e?.entity) && typeof e.entityId === 'string' && typeof e.field === 'string' && isPrimitive(e.value) &&
        typeof e.hlc === 'string' && typeof e.base === 'string';
      if (!ok) return null;
      parseHlc(e.hlc);
      parseHlc(e.base);
    }
    return s as Snapshot;
  } catch {
    return null;
  }
}
