import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import type { ImageStyle, StyleProp } from 'react-native';
import { blobUri } from './blobs';

/** 端末に保存した画像（hash で指す）を表示する。実体の読み込み中・無いときは何も出さない */
export function BlobImage({ hash, style, contentFit }: { hash: string; style?: StyleProp<ImageStyle>; contentFit: 'cover' | 'contain' }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void blobUri(hash).then((u) => live && setUri(u));
    return () => { live = false; };
  }, [hash]);
  return uri ? <Image source={{ uri }} style={style} contentFit={contentFit} /> : null;
}
