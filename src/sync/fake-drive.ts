import type { ChangePage, DriveClient, DriveFile } from './drive';

/** テスト用のインメモリ Drive。changes のトークンは変更ログの添字 */
export class FakeDrive implements DriveClient {
  files = new Map<string, { file: DriveFile; content: string | Uint8Array }>();
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
    return file;
  }
  async createBlob(meta: { name: string; appProperties: Record<string, string> }, bytes: Uint8Array) {
    this.maybeFail();
    const file = { id: `f${++this.seq}`, ...meta };
    this.files.set(file.id, { file, content: bytes });
    this.log.push(file.id);
    return file;
  }
  async downloadBytes(id: string) {
    this.maybeFail();
    this.downloads.push(id);
    return this.files.get(id)!.content as Uint8Array;
  }
  async getStartPageToken() {
    this.maybeFail();
    return String(this.log.length);
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
      changes: this.log.slice(from, from + 2).map((id) => ({ file: this.files.get(id)!.file })), // 小さいページで改ページも検証
      ...(from + 2 < this.log.length ? { nextPageToken: String(from + 2) } : { newStartPageToken: String(this.log.length) }),
    };
  }
  async download(id: string) {
    this.maybeFail();
    this.downloads.push(id);
    return this.files.get(id)!.content as string;
  }
}
