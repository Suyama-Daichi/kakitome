import { MaterialIcons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Animated, Modal, Platform, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createNote, moveNote, toggleItem, updateNote } from '../db/actions';
import { BlobImage } from '../media/BlobImage';
import { ReminderSection } from '../components/ReminderSection';
import { subscribeDbChanges } from '../db/changes';
import { doneItems, lastSyncError, listAttachments, listNotes, type ListView, type NoteRow, type NoteSort } from '../db/queries';
import { onLocalChange, scheduler } from '../sync/auto';
import { isSignedIn } from '../sync/google-auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmDestructive } from '../ui/dialog';
import { showToast } from '../ui/toast';
import { radius, size, space, type, useThemed, type Palette } from '../ui/theme';

const SWIPE_DELETE = -96;

/** 左へスワイプして離すと削除の確認を出す。キャンセルや閾値未満なら元の位置へ戻す */
function SwipeRow({ onDelete, children }: { onDelete: () => void; children: React.ReactNode }) {
  const [, styles] = useThemed(makeStyles);
  const x = useRef(new Animated.Value(0)).current;
  const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > 2 * Math.abs(g.dy),
      onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        back();
        if (g.dx < SWIPE_DELETE) onDelete();
      },
      onPanResponderTerminate: back,
    }),
  ).current;
  return (
    <View style={styles.swipeBox}>
      <View style={styles.swipeBack}><Text style={styles.swipeText}>削除</Text></View>
      <Animated.View style={[styles.swipeFront, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>{children}</Animated.View>
    </View>
  );
}

/** 右端の「≡」を押したまま上下に動かして並び替える。指を離すまで他の操作を横取りされない */
function DragHandle({ onStart, onMove, onEnd }: { onStart: () => void; onMove: (dy: number) => void; onEnd: () => void }) {
  const [p, styles] = useThemed(makeStyles);
  const cb = useRef({ onStart, onMove, onEnd });
  cb.current = { onStart, onMove, onEnd };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => cb.current.onStart(),
      onPanResponderMove: (_, g) => cb.current.onMove(g.dy),
      onPanResponderRelease: () => cb.current.onEnd(),
      onPanResponderTerminate: () => cb.current.onEnd(),
    }),
  ).current;
  return (
    <View {...pan.panHandlers} style={styles.handle} accessibilityLabel="ドラッグして並び替え">
      <MaterialIcons name="drag-indicator" size={20} color={p.dragHandle} />
    </View>
  );
}

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function NoteList() {
  const [p, styles] = useThemed(makeStyles);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<NoteSort>('manual');
  const reload = useCallback(() => setNotes(listNotes(query, sort)), [query, sort]);
  const canDrag = sort === 'manual' && !query; // 並び替えは手動順で、絞り込みなしのときだけ
  useFocusEffect(reload);
  useEffect(() => subscribeDbChanges(reload), [reload]);

  // 並び替え: from のカードを指に追従させ、通り過ぎたカードをその高さ分ずらして見せる。範囲は同じピン留め状態のカードだけ
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const heights = useRef(new Map<string, number>());
  const lastDy = useRef(0);
  const h = (i: number) => heights.current.get(notes[i].id) ?? 100;
  const range = (from: number) => {
    const same = (i: number) => notes[i].pinned === notes[from].pinned;
    let lo = from, hi = from;
    while (lo > 0 && same(lo - 1)) lo--;
    while (hi < notes.length - 1 && same(hi + 1)) hi++;
    return [lo, hi];
  };
  /** 指の移動量 dy から、離したときの位置を求める（隣のカードの半分を越えたら入れ替わる） */
  const target = (from: number, dy: number) => {
    const [lo, hi] = range(from);
    let to = from, acc = 0;
    if (dy > 0) while (to < hi && dy > acc + h(to + 1) / 2) acc += h(++to);
    else while (to > lo && -dy > acc + h(to - 1) / 2) acc += h(--to);
    return to;
  };
  const dragMove = (from: number, dy: number) => {
    lastDy.current = dy;
    dragY.setValue(dy);
    const to = target(from, dy);
    setDrag((d) => (d && d.to !== to ? { from, to } : d));
  };
  const dragEnd = (from: number) => {
    const [lo, hi] = range(from);
    const to = target(from, lastDy.current);
    lastDy.current = 0;
    setDrag(null);
    dragY.setValue(0);
    if (to === from) return;
    const group = notes.slice(lo, hi + 1);
    group.splice(to - lo, 0, ...group.splice(from - lo, 1));
    moveNote(group, to - lo);
    reload();
    onLocalChange();
  };
  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h(drag.from);
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return h(drag.from);
    return 0;
  };

  const remove = (n: NoteRow) =>
    confirmDestructive('メモを削除', `「${n.title || n.body.split('\n')[0] || '無題のメモ'}」を削除しますか？`, () => { updateNote(n.id, { deleted: 1 }); onLocalChange(); });

  const open = (id: string) => router.push({ pathname: '/note/[id]', params: { id } });
  // 完了項目を展開しているカード
  const [refreshing, setRefreshing] = useState(false);
  const [remindOpen, setRemindOpen] = useState<Set<string>>(new Set());
  const toggleRemind = (id: string) => {
    const next = new Set(remindOpen);
    if (next.delete(id)) reload(); // 閉じるときに、編集したリマインドを一覧へ反映
    else next.add(id);
    setRemindOpen(next);
  };
  const SORTS: { label: string; value: NoteSort }[] = [
    { label: '手動', value: 'manual' },
    { label: 'リマインドが近い順', value: 'reminder' },
    { label: '作成が新しい順', value: 'created' },
    { label: 'タイトル順', value: 'title' },
  ];
  const [sortMenu, setSortMenu] = useState(false);
  // 長押しで開く、カードのメイン表示の切り替えメニュー
  const VIEWS: { label: string; value: ListView }[] = [
    { label: 'チェックリスト', value: '' },
    { label: 'メモ', value: 'memo' },
    { label: '画像', value: 'image' },
  ];
  const [viewMenu, setViewMenu] = useState<string | null>(null);
  const chooseView = (id: string, v: ListView) => { updateNote(id, { list_view: v }); onLocalChange(); setViewMenu(null); reload(); };
  const chooseSort = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: '並び替え', options: [...SORTS.map((o) => o.label), 'キャンセル'], cancelButtonIndex: SORTS.length },
        (i) => i < SORTS.length && setSort(SORTS[i].value),
      );
    } else {
      setSortMenu(true); // Android の Alert はボタン 3 つまでなので、自前のメニュー
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    await scheduler.trigger();
    setRefreshing(false);
    // 失敗は例外にならず last_error に残る（成功時は空文字）
    showToast(!isSignedIn() ? '設定で同期をオンにすると使えます' : lastSyncError() ? '同期に失敗しました' : '同期しました');
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const check = (itemId: string) => { toggleItem(itemId); onLocalChange(); reload(); };

  const openCount = notes.reduce((a, n) => a + n.open_count, 0);
  const doneCount = notes.reduce((a, n) => a + n.total_count - n.open_count, 0);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Google Keep のように、一覧の上に検索ボックスを置く。並び替えと設定はボックスの右端 */}
      <View style={[styles.searchBox, { marginTop: insets.top + 8 }]}>
        <MaterialIcons name="search" size={22} color={p.inkMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="メモを検索"
          placeholderTextColor={p.inkMuted}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="検索をクリア">
            <MaterialIcons name="close" size={20} color={p.inkMuted} />
          </Pressable>
        ) : null}
        <Pressable onPress={chooseSort} accessibilityLabel="並び替え" hitSlop={6} style={styles.iconButton}>
          <MaterialIcons name="sort" size={22} color={sort === 'manual' ? p.ink : p.accentText} />
        </Pressable>
        <Pressable onPress={() => router.push('/settings')} accessibilityLabel="設定" hitSlop={6} style={styles.iconButton}>
          <MaterialIcons name="settings" size={22} color={p.ink} />
        </Pressable>
      </View>
      <Modal visible={sortMenu} transparent animationType="fade" onRequestClose={() => setSortMenu(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setSortMenu(false)}>
          <View style={[styles.menu, { top: insets.top + 60 }]}>
            {SORTS.map((o) => (
              <Pressable key={o.value} style={styles.menuItem} onPress={() => { setSort(o.value); setSortMenu(false); }}>
                <Text style={[styles.menuText, sort === o.value && styles.menuTextOn]}>{o.label}</Text>
                {sort === o.value ? <MaterialIcons name="check" size={18} color={p.accentText} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      <Modal visible={viewMenu !== null} transparent animationType="fade" onRequestClose={() => setViewMenu(null)}>
        <Pressable style={[styles.menuBackdrop, styles.center]} onPress={() => setViewMenu(null)}>
          <View style={[styles.menu, styles.centerMenu]}>
            <Text style={styles.menuHead}>メインで表示</Text>
            {VIEWS.map((o) => {
              const on = notes.find((n) => n.id === viewMenu)?.list_view === o.value;
              return (
                <Pressable key={o.value} style={styles.menuItem} onPress={() => viewMenu && chooseView(viewMenu, o.value)}>
                  <Text style={[styles.menuText, on && styles.menuTextOn]}>{o.label}</Text>
                  {on ? <MaterialIcons name="check" size={18} color={p.accentText} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
      <ScrollView
        scrollEnabled={!drag}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }>
        <Text style={styles.meta}>
          未完了 <Text style={styles.metaOpen}>{openCount}</Text> · 完了 {doneCount} · メモ {notes.length}
        </Text>
        {notes.length ? null : <Text style={styles.empty}>{query ? '見つかりませんでした' : 'メモはまだありません'}</Text>}
        {notes.map((n, i) => {
          const done = n.total_count - n.open_count;
          const more = n.open_count - n.preview.length;
          const first = n.body.split('\n')[0];
          const view = n.list_view;
          const list = !view;
          return (
            <Animated.View
              key={n.id}
              onLayout={(e) => { heights.current.set(n.id, e.nativeEvent.layout.height + space.m); }}
              style={[styles.cell, drag?.from === i ? { zIndex: 1, elevation: 6, transform: [{ translateY: dragY }] } : { transform: [{ translateY: shift(i) }] }]}
            >
              <SwipeRow onDelete={() => remove(n)}>
                <View style={styles.card}>
                  <Pressable style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]} onPress={() => open(n.id)} onLongPress={() => setViewMenu(n.id)}>
                    <View style={styles.titleRow}>
                      {n.pinned ? <MaterialIcons name="push-pin" size={16} color={p.yellowText} /> : null}
                      <Text style={styles.title} numberOfLines={1}>{n.title || first || '無題のメモ'}</Text>
                      {n.total_count ? <Text style={styles.count}>{done}/{n.total_count}</Text> : null}
                    </View>
                    {view === 'memo' ? (
                      n.body ? <Text style={styles.excerpt} numberOfLines={6}>{n.body}</Text> : null
                    ) : view === 'image' ? (
                      <ImageStrip noteId={n.id} />
                    ) : n.total_count ? (
                      <View style={styles.bar}><View style={[styles.barFill, { width: `${(done / n.total_count) * 100}%` }]} /></View>
                    ) : n.title ? (
                      first ? <Text style={styles.excerpt} numberOfLines={2}>{n.body}</Text> : null
                    ) : null}
                  </Pressable>
                  {list ? n.preview.map((it) => (
                    <Pressable key={it.id} style={styles.itemRow} onPress={() => check(it.id)} accessibilityLabel="完了にする">
                      <View style={styles.box} />
                      <Text style={styles.itemText} numberOfLines={1}>{it.text}</Text>
                    </Pressable>
                  )) : null}
                  {list && n.total_count && !n.open_count ? (
                    <Pressable style={styles.allDone} onPress={() => toggleExpanded(n.id)} accessibilityLabel="完了した項目を表示">
                      <MaterialIcons name="task-alt" size={16} color={p.accentText} />
                      <Text style={styles.allDoneText}>すべて完了</Text>
                      <MaterialIcons name={expanded.has(n.id) ? 'expand-less' : 'expand-more'} size={18} color={p.inkFaint} />
                    </Pressable>
                  ) : list && (more > 0 || (n.preview.length && done)) ? (
                    <Pressable style={styles.moreRow} onPress={() => toggleExpanded(n.id)} accessibilityLabel="完了した項目を表示">
                      <Text style={styles.more}>{more > 0 ? `ほか ${more} 件` : ''}{more > 0 && done ? ' · ' : ''}{done ? `完了 ${done}` : ''}</Text>
                      {done ? <MaterialIcons name={expanded.has(n.id) ? 'expand-less' : 'expand-more'} size={16} color={p.inkFaint} /> : null}
                    </Pressable>
                  ) : null}
                  {list && expanded.has(n.id) ? doneItems(n.id).map((it) => (
                    <Pressable key={it.id} style={styles.itemRow} onPress={() => check(it.id)} accessibilityLabel="未完了に戻す">
                      <View style={[styles.box, styles.boxOn]}><MaterialIcons name="check" size={13} color="#fff" /></View>
                      <Text style={[styles.itemText, styles.itemDone]} numberOfLines={1}>{it.text}</Text>
                    </Pressable>
                  )) : null}
                  {n.next_reminder || n.conflict_count || n.conflict_of || n.image_count ? (
                    <View style={styles.chips}>
                      {n.next_reminder ? (
                        <Pressable onPress={() => toggleRemind(n.id)} hitSlop={6} accessibilityLabel="リマインドを編集">
                          <Chip icon="alarm" bg={p.reminderBg} fg={p.reminderFg} text={fmtWhen(n.next_reminder)} mono trailing={remindOpen.has(n.id) ? 'expand-less' : 'expand-more'} />
                        </Pressable>
                      ) : null}
                      {n.conflict_count ? <Chip icon="sync-problem" bg={p.dangerBg} fg={p.dangerFg} text={`競合 ${n.conflict_count}`} /> : null}
                      {n.conflict_of ? <Chip icon="sync-problem" bg={p.dangerBg} fg={p.dangerFg} text="競合コピー" /> : null}
                      {n.image_count ? <Chip icon="image" bg={p.chipBg} fg={p.chipFg} text={String(n.image_count)} /> : null}
                    </View>
                  ) : null}
                  {remindOpen.has(n.id) ? (
                    <View style={styles.remind}>
                      <ReminderSection noteId={n.id} />
                    </View>
                  ) : null}
                  {canDrag ? (
                    <View style={styles.handleSlot}>
                      <DragHandle onStart={() => setDrag({ from: i, to: i })} onMove={(dy) => dragMove(i, dy)} onEnd={() => dragEnd(i)} />
                    </View>
                  ) : null}
                </View>
              </SwipeRow>
            </Animated.View>
          );
        })}
      </ScrollView>
      <Pressable style={styles.fab} onPress={() => open(createNote())} accessibilityLabel="新しいメモ">
        <MaterialIcons name="add" size={28} color={p.onYellow} />
      </Pressable>
    </View>
  );
}

/** 画像モードのカード: 添付のサムネイルを横に並べる（一覧の読み込みごとに引き直す） */
function ImageStrip({ noteId }: { noteId: string }) {
  const [, styles] = useThemed(makeStyles);
  const imgs = listAttachments(noteId);
  if (!imgs.length) return <Text style={styles.excerpt}>画像はありません</Text>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {imgs.map((a) =>
        // サムネイルは同期の最後に届くので、実体が届くまでは枠だけ出す（BlobImage は hash が同じだと読み直さないため、届いたら作り直させる）
        a.has_thumb ? <BlobImage key={a.id} hash={a.thumb_hash} style={styles.stripImg} contentFit="cover" /> : <View key={a.id} style={[styles.stripImg, styles.stripEmpty]} />,
      )}
    </ScrollView>
  );
}

function Chip({ icon, bg, fg, text, mono, trailing }: { trailing?: React.ComponentProps<typeof MaterialIcons>['name']; icon: React.ComponentProps<typeof MaterialIcons>['name']; bg: string; fg: string; text: string; mono?: boolean }) {
  const [, styles] = useThemed(makeStyles);
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <MaterialIcons name={icon} size={13} color={fg} />
      <Text style={[styles.chipText, { color: fg }, mono && type.monoMeta]}>{text}</Text>
      {trailing ? <MaterialIcons name={trailing} size={14} color={fg} /> : null}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: p.bg },
    list: { paddingHorizontal: space.screen, paddingBottom: 110 },
    meta: { ...type.monoMeta, color: p.inkFaint, paddingHorizontal: 6, paddingVertical: space.m },
    metaOpen: { color: p.yellowText },
    empty: { ...type.small, textAlign: 'center', color: p.inkMuted, marginTop: 80 },
    cell: { marginBottom: space.m },
    swipeBox: { backgroundColor: p.danger, borderRadius: radius.card, overflow: 'hidden' },
    swipeBack: { ...(StyleSheet.absoluteFill as object), justifyContent: 'center', alignItems: 'flex-end', paddingRight: 24 },
    swipeText: { color: p.onDanger, fontWeight: '600' },
    swipeFront: { backgroundColor: p.bg },
    card: { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: radius.card, paddingVertical: 12, paddingHorizontal: space.xxl },
    cardMain: { gap: 8, paddingRight: 24 },
    pressed: { opacity: 0.7 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { ...type.cardTitle, color: p.ink, flex: 1 },
    count: { ...type.monoMeta, color: p.inkFaint },
    bar: { height: size.progress, borderRadius: 2, backgroundColor: p.border, overflow: 'hidden' },
    barFill: { height: size.progress, backgroundColor: p.accent },
    excerpt: { ...type.small, lineHeight: 22, color: p.inkMuted },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: size.rowList },
    box: { width: size.checkboxList, height: size.checkboxList, borderRadius: radius.checkboxSmall, borderWidth: 1.5, borderColor: p.checkboxBorder },
    itemText: { ...type.item, color: p.ink, flex: 1 },
    moreRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2, alignSelf: 'flex-start' },
    more: { ...type.caption, color: p.inkFaint },
    boxOn: { backgroundColor: p.accent, borderColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    itemDone: { color: p.inkDone, textDecorationLine: 'line-through' },
    allDone: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, alignSelf: 'flex-start' },
    allDoneText: { ...type.item, color: p.accentText },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.chip, paddingHorizontal: 8, paddingVertical: 3 },
    chipText: { ...type.caption },
    remind: { marginTop: 10, marginBottom: 2 },
    handleSlot: { position: 'absolute', top: 4, right: 0 },
    handle: { paddingHorizontal: 10, paddingVertical: 10 },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 48, marginHorizontal: space.screen, paddingLeft: 14, paddingRight: 6, backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: 24 },
    menuBackdrop: { flex: 1 },
    center: { justifyContent: 'center', alignItems: 'center' },
    centerMenu: { position: 'relative', right: undefined, minWidth: 240 },
    menuHead: { ...type.caption, color: p.inkFaint, paddingHorizontal: 16, paddingVertical: 8 },
    strip: { gap: 8 },
    stripImg: { width: 88, height: 88, borderRadius: 8 },
    stripEmpty: { backgroundColor: p.border },
    menu: { position: 'absolute', right: space.screen, minWidth: 200, backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: radius.card, paddingVertical: 6, elevation: 6 },
    menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
    menuText: { ...type.item, color: p.ink },
    menuTextOn: { color: p.accentText, fontWeight: '600' },
    searchInput: { flex: 1, ...type.item, color: p.ink, paddingVertical: 0 },
    iconButton: { padding: 6 },
    fab: { position: 'absolute', right: 16, bottom: 32, width: size.fab, height: size.fab, borderRadius: radius.fab, backgroundColor: p.yellow, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: p.shadow },
  });
