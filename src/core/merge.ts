import { v5 as uuidv5 } from 'uuid';
import { formatHlc, parseHlc, type Clock } from './hlc';
import type { Entity, Json, Op } from './ops';
import type { Store } from './store';

export interface Ctx {
  store: Store;
  clock: Clock;
  /** UUIDv7 を返す関数（呼び出し側で注入。core は乱数源に依存しない） */
  newId: () => string;
}

// 競合コピー ID 生成用の固定名前空間（変更すると端末間で ID が食い違う）
const CONFLICT_NS = '6f0c8a52-7d1e-5b3a-9c44-1f2d3e4a5b6c';

/** 自端末の変更。op を作って適用し、送信待ちとして記録する */
export function applyLocalOp(
  ctx: Ctx,
  entity: Entity,
  entityId: string,
  fields: Record<string, Json>,
): Op {
  const base: Record<string, string> = {};
  for (const f of Object.keys(fields)) {
    const cur = ctx.store.getField(entity, entityId, f);
    if (cur) base[f] = cur.hlc;
  }
  const op: Op = { id: ctx.newId(), hlc: ctx.clock.now(), entity, entityId, fields, base };
  ctx.store.putOp(op, false);
  applyOp(ctx.store, op);
  return op;
}

/** 他端末の op を適用する。順序・重複に依らず同じ状態に収束する */
export function mergeRemoteOps(ctx: Ctx, ops: Op[]): void {
  for (const op of ops) {
    if (ctx.store.hasOp(op.id)) continue;
    ctx.clock.receive(op.hlc);
    ctx.store.putOp(op, true);
    applyOp(ctx.store, op);
  }
}

function applyOp(store: Store, op: Op): void {
  for (const [field, value] of Object.entries(op.fields)) {
    const cur = store.getField(op.entity, op.entityId, field);
    if (cur?.hlc === op.hlc) continue;
    const base = op.base[field];
    const wins = !cur || op.hlc > cur.hlc;

    // §5.2: 互いに相手を見ずに書かれた title/body のみ競合として扱う
    if (cur && op.entity === 'note' && (field === 'title' || field === 'body')) {
      // 同じ端末の op 同士は必ず順序づけられている（端末は自分の過去の編集を見ている）ので、同時編集ではない。
      // 圧縮（スナップショット）で途中の op が無くなっても、連続編集が競合と誤判定されない
      if (base !== undefined && base !== cur.hlc && cur.base !== op.hlc && parseHlc(cur.hlc).device !== parseHlc(op.hlc).device) {
        const loser = wins
          ? { value: cur.value, hlc: cur.hlc, base: cur.base, opId: store.getOpByHlc(cur.hlc)?.id }
          : { value, hlc: op.hlc, base, opId: op.id };
        createConflictCopy(store, op.entityId, field, loser);
      }
    }

    if (wins) store.setField(op.entity, op.entityId, field, { value, hlc: op.hlc, base });
  }
}

interface Loser {
  value: Json;
  hlc: string;
  base?: string;
  opId?: string;
}

/** 敗者の値を持つ新規メモを、敗者 op から決定的に作る（全端末で同一の op になり冪等） */
function createConflictCopy(store: Store, noteId: string, field: string, loser: Loser): void {
  // ponytail: opId が引けない（圧縮済み）場合は hlc で代用。端末間で ID が揃う保証は opId が引ける場合のみ
  const copyId = uuidv5(`${noteId}:${loser.opId ?? loser.hlc}:${field}`, CONFLICT_NS);
  const id = uuidv5(`${copyId}:create`, CONFLICT_NS);
  if (store.hasOp(id)) return;

  const h = parseHlc(loser.hlc);
  const op: Op = {
    id,
    // 敗者と同じ時刻で、端末IDだけ変えて他の op と HLC が衝突しないようにする
    hlc: formatHlc({ ...h, device: `conflict-${h.device}` }),
    entity: 'note',
    entityId: copyId,
    fields: {
      title: '',
      body: '',
      [field]: loser.value,
      pinned: 0,
      sort_key: loser.hlc,
      deleted: 0,
      created_at: new Date(h.ms).toISOString(),
      conflict_of: noteId,
      conflict_field: field,
      conflict_base_hlc: loser.base ?? null,
    },
    base: {},
  };
  store.putOp(op, true); // 全端末が同じ op を導出するので送信しない
  applyOp(store, op);
}
