import type { ChangePage, DriveClient, DriveFile } from './drive';

/** テスト用のインメモリ Drive。changes のトークンは変更ログの添字 */
export class FakeDrive implements DriveClient {
  files = new Map<string, { file: DriveFile; content: string | Uint8Array }>();
  /** 変更ログ。作成は { id }、削除は { id, removed: true } */
  changes: { id: string; removed?: boolean }[] = [];
  log: string[] = [];
  /** 通信エラーを起こす残り回数（3 呼び出しに 1 回消費）。尽きれば以後は成功する */
  failBudget = 0;
  downloads: string[] = [];
  listAllCalls = 0;
  private calls = 0;
  private seq = 0;

  private maybeFail() {
    if (this.failBudget > 0 && ++this.calls % 3 === 0) {
      this.failBudget--;
      throw new Error('network');
    }
  }

  async createFile(meta: { name: string; appProperties: Record<string, string> }, content: string) {
    this.maybeFail();
    const file = { id: `f${++this.seq}`, ...meta };
    this.files.set(file.id, { file, content });
    this.log.push(file.id);
    this.changes.push({ id: file.id });
    return file;
  }
  async createBlob(meta: { name: string; appProperties: Record<string, string> }, bytes: Uint8Array) {
    this.maybeFail();
    const file = { id: `f${++this.seq}`, ...meta };
    this.files.set(file.id, { file, content: bytes });
    this.log.push(file.id);
    this.changes.push({ id: file.id });
    return file;
  }
  async downloadBytes(id: string) {
    this.maybeFail();
    this.downloads.push(id);
    return this.files.get(id)!.content as Uint8Array;
  }
  async deleteFile(id: string) {
    this.maybeFail();
    if (this.files.delete(id)) this.changes.push({ id, removed: true });
  }
  async usage() {
    this.maybeFail();
    return [...this.files.values()].reduce((n, f) => n + (typeof f.content === 'string' ? f.content.length : f.content.length), 0);
  }
  async getStartPageToken() {
    this.maybeFail();
    return String(this.changes.length);
  }
  async listFiles() {
    this.maybeFail();
    this.listAllCalls++;
    return [...this.files.values()].map((f) => f.file);
  }
  async listChanges(token: string): Promise<ChangePage> {
    this.maybeFail();
    const from = Number(token);
    return {
      changes: this.changes.slice(from, from + 2).map((c) => (c.removed ? { fileId: c.id, removed: true } : { fileId: c.id, file: this.files.get(c.id)?.file })), // 小さいページで改ページも検証
      ...(from + 2 < this.changes.length ? { nextPageToken: String(from + 2) } : { newStartPageToken: String(this.changes.length) }),
    };
  }
  async download(id: string) {
    this.maybeFail();
    this.downloads.push(id);
    return this.files.get(id)!.content as string;
  }
}
