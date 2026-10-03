import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { isSignedIn } from './google-auth';
import { runSync } from './run';

export const SYNC_TASK = 'kakitome-sync';

// グローバルスコープで定義する必要がある（ルートの index.ts から import される）
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    if (isSignedIn()) await runSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** OS 任せのベストエフォート（最短 15 分間隔） */
export const registerBackgroundSync = () =>
  BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 }).catch(() => {});
