import { Alert, Platform } from 'react-native';

// react-native-web の Alert.alert は何もしないので、Web ではブラウザのダイアログを使う
export function confirmDestructive(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'キャンセル', style: 'cancel' },
    { text: '削除', style: 'destructive', onPress: onConfirm },
  ]);
}

export function notify(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
  else Alert.alert(title, message);
}
