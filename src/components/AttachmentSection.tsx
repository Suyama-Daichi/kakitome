import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { addAttachment, deleteAttachment } from '../db/actions';
import { subscribeDbChanges } from '../db/changes';
import { listAttachments, type AttachmentView } from '../db/queries';
import { blobFile } from '../media/blobs';
import { touchBlob } from '../media/blob-port';
import { ensureBody, type BodyResult } from '../media/body';
import { importImage } from '../media/process';
import { onLocalChange } from '../sync/auto';
import { radius, space, type, useThemed, type Palette } from '../ui/theme';

const THUMB = 96;

/** 添付エリア方式: 本文・チェックリストの下に横スクロールのサムネイル一覧（設計 §7.1） */
export function AttachmentSection({ noteId }: { noteId: string }) {
  const [p, styles] = useThemed(makeStyles);
  const [items, setItems] = useState<AttachmentView[]>(() => listAttachments(noteId));
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<AttachmentView | null>(null);
  const [bodyState, setBodyState] = useState<BodyResult | 'loading'>('ready');
  const reload = useCallback(() => setItems(listAttachments(noteId)), [noteId]);
  useEffect(() => subscribeDbChanges(reload), [reload]);

  const add = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, exif: false });
    if (res.canceled) return;
    setBusy(true);
    try {
      for (const asset of res.assets) addAttachment(noteId, await importImage(asset.uri));
      reload();
      onLocalChange();
    } catch (e) {
      Alert.alert('画像を追加できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fileUri = (hash: string) => blobFile(hash).uri;

  // 本体が未取得なら、表示するときに取得する（Wi-Fi 限定設定に従う）
  const open = async (a: AttachmentView) => {
    setViewing(a);
    if (a.has_body) {
      touchBlob(a.hash);
      return setBodyState('ready');
    }
    setBodyState('loading');
    const r = await ensureBody(a.hash);
    setBodyState(r);
    if (r === 'ready') reload();
  };

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>画像</Text>
      {items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {items.map((a) => (
            <View key={a.id}>
              <Pressable onPress={() => void open(a)} accessibilityLabel="画像を表示">
                {a.has_thumb ? (
                  <Image source={{ uri: fileUri(a.thumb_hash) }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.placeholder]}>
                    <Text style={styles.placeholderText}>Wi-Fi 接続時に同期されます</Text>
                  </View>
                )}
              </Pressable>
              <Pressable style={styles.remove} hitSlop={8} onPress={() => { deleteAttachment(a.id); reload(); onLocalChange(); }} accessibilityLabel="画像を削除">
                <MaterialIcons name="close" size={13} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {busy ? <ActivityIndicator color={p.accent} /> : (
        <Pressable style={styles.addRow} onPress={add}><MaterialIcons name="add-photo-alternate" size={20} color={p.accentText} /><Text style={styles.add}>画像を追加</Text></Pressable>
      )}
      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewing(null)}>
          {viewing ? (
            viewing.has_body || viewing.has_thumb ? (
              <Image source={{ uri: fileUri(viewing.has_body ? viewing.hash : viewing.thumb_hash) }} style={styles.full} contentFit="contain" />
            ) : null
          ) : null}
          {viewing && !viewing.has_body ? (
            <Text style={styles.viewerNote}>
              {bodyState === 'loading' ? '画像を取得しています…' : bodyState === 'wifi' ? 'Wi-Fi 接続時に高画質の画像を同期します' : bodyState === 'unavailable' ? '画像はまだ同期されていません' : ''}
            </Text>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    box: { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: space.cardPad, gap: 8 },
    heading: { ...type.label, color: p.inkFaint },
    row: { gap: 8 },
    thumb: { width: THUMB, height: THUMB, borderRadius: 10, backgroundColor: p.chipBg, borderColor: p.border, borderWidth: 1 },
    placeholder: { alignItems: 'center', justifyContent: 'center', padding: 6, borderStyle: 'dashed', borderColor: p.borderControl },
    placeholderText: { fontSize: 10, color: p.inkMuted, textAlign: 'center' },
    remove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
    add: { ...type.item, fontWeight: '500', color: p.accentText },
    viewer: { flex: 1, backgroundColor: p.viewerBg, alignItems: 'center', justifyContent: 'center' },
    full: { width: '100%', height: '100%' },
    viewerNote: { position: 'absolute', bottom: 48, color: '#dfe8e5', fontSize: 13 },
  });
