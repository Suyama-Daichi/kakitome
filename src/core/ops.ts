export type Entity = 'note' | 'checklist_item' | 'reminder' | 'attachment';
export type Json = string | number | boolean | null;

export interface Op {
  id: string;
  hlc: string;
  entity: Entity;
  entityId: string;
  /** 作成=全フィールド / 更新=変更分 / 削除={deleted:1} */
  fields: Record<string, Json>;
  /** 編集時に見ていた各フィールドの HLC（競合検出用）。新規フィールドは持たない */
  base: Record<string, string>;
}

export const ENTITIES: readonly string[] = ['note', 'checklist_item', 'reminder', 'attachment'];
export const isPrimitive = (v: unknown): v is Json => v === null || ['string', 'number', 'boolean'].includes(typeof v);
