// Drive API v3 の appDataFolder 向け最小クライアント。fetch とトークン取得は注入する（テスト・RN 非依存のため）
export interface DriveFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}
export interface Change {
  fileId?: string;
  removed?: boolean;
  file?: DriveFile;
}
export interface ChangePage {
  changes: Change[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

export interface DriveClient {
  /** 新規作成のみ。既存ファイルの上書きはしない（設計 §6.2: ファイルは不変） */
  createFile(meta: { name: string; appProperties: Record<string, string> }, content: string): Promise<DriveFile>;
  /** 画像などのバイナリ。atomic にするため作成と本体を 1 リクエスト（multipart）で送る */
  createBlob(meta: { name: string; appProperties: Record<string, string> }, bytes: Uint8Array): Promise<DriveFile>;
  downloadBytes(fileId: string): Promise<Uint8Array>;
  /** appDataFolder のファイルは完全削除になる（ゴミ箱は使えない）。既に無ければ成功扱い */
  deleteFile(fileId: string): Promise<void>;
  /** appDataFolder 内のファイルのサイズ合計（バイト） */
  usage(): Promise<number>;
  getStartPageToken(): Promise<string>;
  /** 初回同期用。appDataFolder の全ファイル */
  listFiles(): Promise<DriveFile[]>;
  listChanges(pageToken: string): Promise<ChangePage>;
  download(fileId: string): Promise<string>;
}

export class DriveError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Drive API ${status}: ${body}`);
  }
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,appProperties';

/** onUnauthorized: 401（トークン期限切れ）のとき、使ったトークンを破棄するために呼ばれる。その後 1 回だけ再試行する */
export function createDriveClient(
  fetchFn: typeof fetch,
  getToken: () => Promise<string>,
  onUnauthorized?: (token: string) => Promise<void>,
): DriveClient {
  async function call(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await getToken();
    const res = await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401 && onUnauthorized && !retried) {
      await onUnauthorized(token);
      return call(url, init, true);
    }
    if (!res.ok) throw new DriveError(res.status, await res.text());
    return res;
  }
  const qs = (p: Record<string, string>) => new URLSearchParams(p).toString();

  return {
    async createFile(meta, content) {
      let boundary = 'kakitome_boundary';
      while (content.includes(boundary)) boundary += Math.random().toString(36).slice(2, 6);
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ ...meta, parents: ['appDataFolder'] })}\r\n` +
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--`;
      const res = await call(`${UPLOAD}/files?${qs({ uploadType: 'multipart', fields: FILE_FIELDS })}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return res.json();
    },

    async createBlob(meta, bytes) {
      const enc = new TextEncoder();
      const boundary = `kakitome_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
      const head = enc.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ ...meta, parents: ['appDataFolder'] })}\r\n` +
          `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      );
      const tail = enc.encode(`\r\n--${boundary}--`);
      const body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head, 0);
      body.set(bytes, head.length);
      body.set(tail, head.length + bytes.length);
      const res = await call(`${UPLOAD}/files?${qs({ uploadType: 'multipart', fields: FILE_FIELDS })}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return res.json();
    },

    async downloadBytes(fileId) {
      return new Uint8Array(await (await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).arrayBuffer());
    },

    async deleteFile(fileId) {
      try {
        await call(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      } catch (e) {
        if (!(e instanceof DriveError && e.status === 404)) throw e;
      }
    },

    async usage() {
      let total = 0;
      let pageToken: string | undefined;
      do {
        const p: Record<string, string> = { spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(size)' };
        if (pageToken) p.pageToken = pageToken;
        const r = await (await call(`${API}/files?${qs(p)}`)).json();
        for (const f of r.files) total += Number(f.size ?? 0);
        pageToken = r.nextPageToken;
      } while (pageToken);
      return total;
    },

    async getStartPageToken() {
      // getStartPageToken に spaces パラメータは無い。取得したトークンを changes.list(spaces=appDataFolder) に渡す
      return (await (await call(`${API}/changes/startPageToken`)).json()).startPageToken;
    },

    async listFiles() {
      const files: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const p: Record<string, string> = { spaces: 'appDataFolder', pageSize: '1000', fields: `nextPageToken,files(${FILE_FIELDS})` };
        if (pageToken) p.pageToken = pageToken;
        const r = await (await call(`${API}/files?${qs(p)}`)).json();
        files.push(...r.files);
        pageToken = r.nextPageToken;
      } while (pageToken);
      return files;
    },

    async listChanges(pageToken) {
      const p = {
        pageToken,
        spaces: 'appDataFolder',
        pageSize: '1000',
        includeRemoved: 'true',
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      };
      return (await call(`${API}/changes?${qs(p)}`)).json();
    },

    async download(fileId) {
      return (await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).text();
    },
  };
}
