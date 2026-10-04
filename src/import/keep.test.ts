import { isEmptyNote, parseKeepNote } from './keep';

describe('parseKeepNote', () => {
  it('テキストのメモ', () => {
    const n = parseKeepNote({ title: '買い物', textContent: '牛乳', isPinned: true, isTrashed: false, createdTimestampUsec: 1700000000000000, userEditedTimestampUsec: 1700000100000000, labels: [{ name: '家' }, { name: '急ぎ' }] });
    expect(n).toMatchObject({ title: '買い物', body: '牛乳\n\nラベル: 家, 急ぎ', pinned: true, trashed: false, items: [], key: 'keep:1700000000000000' });
    expect(n?.createdAt).toBe('2023-11-14T22:13:20.000Z');
    expect(n?.editedAt).toBe(1700000100000);
  });

  it('チェックリストのメモ', () => {
    const n = parseKeepNote({ title: 'ToDo', listContent: [{ text: 'a', isChecked: false }, { text: 'b', isChecked: true }], createdTimestampUsec: 1 });
    expect(n?.items).toEqual([{ text: 'a', checked: false }, { text: 'b', checked: true }]);
    expect(n?.body).toBe('');
  });

  it('添付とゴミ箱', () => {
    const n = parseKeepNote({ isTrashed: true, createdTimestampUsec: 1, attachments: [{ filePath: 'x.jpg', mimetype: 'image/jpeg' }, { mimetype: 'audio/3gp' }] });
    expect(n?.trashed).toBe(true);
    expect(n?.attachments).toEqual([{ name: 'x.jpg', mime: 'image/jpeg' }]);
  });

  it('Keep のメモではない JSON・壊れた値は null か空として扱う', () => {
    expect(parseKeepNote(null)).toBeNull();
    expect(parseKeepNote({ foo: 1 })).toBeNull();
    const n = parseKeepNote({ textContent: 5, listContent: 'x', createdTimestampUsec: 'abc' });
    expect(n && isEmptyNote(n)).toBe(true);
  });

  it('作成時刻が無いときも、中身から決まる同じ key になる', () => {
    expect(parseKeepNote({ title: 't', textContent: 'b' })?.key).toBe(parseKeepNote({ title: 't', textContent: 'b' })?.key);
  });
});
