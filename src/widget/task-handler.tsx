import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { toggleItem } from '../db/actions';
import { firstNoteWithItems } from '../db/queries';
import { scheduler } from '../sync/auto';
import { ChecklistWidget } from './ChecklistWidget';

// ヘッドレス JS で動く。UI・画像処理系の依存は持たせない（design §8）
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== 'Checklist') return;
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'TOGGLE_ITEM') {
    toggleItem(String(props.clickActionData?.itemId));
  }
  if (['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED', 'WIDGET_CLICK'].includes(props.widgetAction)) {
    props.renderWidget(<ChecklistWidget note={firstNoteWithItems()} />);
  }
  // 描画を先に済ませてから同期する（失敗しても次回のトリガーで再試行）
  if (props.widgetAction === 'WIDGET_CLICK') await scheduler.trigger();
}
