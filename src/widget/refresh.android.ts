import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { createElement } from 'react';
import { widgetNote } from '../db/queries';
import { ChecklistWidget } from './ChecklistWidget';

/** アプリ内の変更をホーム画面のウィジェットへ反映する（Android のみ） */
export function refreshWidget() {
  if (Platform.OS !== 'android') return;
  requestWidgetUpdate({
    widgetName: 'Checklist',
    renderWidget: ({ widgetId }) => createElement(ChecklistWidget, { note: widgetNote(widgetId) }),
    widgetNotFound: () => {},
  }).catch(() => {});
}
