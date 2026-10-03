import { Directory, File, Paths } from 'expo-file-system';

// iOS ではアプリ更新で document のパスが変わりうるので、DB には相対名（blobs/<hash>）だけを持つ
const dir = () => new Directory(Paths.document, 'blobs');

export function blobFile(hash: string): File {
  return new File(Paths.document, 'blobs', hash);
}

export function writeBlob(hash: string, bytes: Uint8Array): void {
  dir().create({ intermediates: true, idempotent: true });
  const f = blobFile(hash);
  if (!f.exists) f.create();
  f.write(bytes);
}
