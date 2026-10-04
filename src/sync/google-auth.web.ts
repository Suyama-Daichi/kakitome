import { DRIVE_APPDATA_SCOPE, WEB_CLIENT_ID } from './config';

// Web: リダイレクト型の OAuth（implicit フロー）。SQLite の同期 API のため COOP: same-origin を付けており、
// Google Identity Services のポップアップ方式はその下で動かないため。
// アクセストークンは約 1 時間で切れる。切れたら未サインイン扱いにし、設定からもう一度サインインする（同意済みなら画面は一瞬）。
// Google Cloud のウェブ クライアントに、承認済みの JavaScript 生成元とリダイレクト URI（配信元の URL）の登録が要る
const KEY = 'kakitome.google';
const STATE_KEY = 'kakitome.google.state';

type Saved = { token: string; expiresAt: number };

// リダイレクトで戻ってきたときの #access_token=… を取り込む
function takeRedirect() {
  const q = new URLSearchParams(location.hash.slice(1));
  const token = q.get('access_token');
  if (!token) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (q.get('state') !== sessionStorage.getItem(STATE_KEY)) return; // 自分が始めたサインインではない
  sessionStorage.removeItem(STATE_KEY); // 1 回限り
  const saved: Saved = { token, expiresAt: Date.now() + Number(q.get('expires_in') ?? 0) * 1000 };
  localStorage.setItem(KEY, JSON.stringify(saved));
}
takeRedirect();

const saved = (): Saved | null => {
  try {
    const s: Saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s && s.expiresAt - 60_000 > Date.now() ? s : null;
  } catch {
    return null;
  }
};

export const googleAvailable = true;
export const isSignedIn = () => saved() !== null;
export const currentEmail = () => null; // drive.appdata 以外のスコープは求めないので、メールアドレスは取れない

/** ページ遷移して戻ってくるので、ここでは解決しない */
export async function signIn(): Promise<boolean> {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  location.assign(
    'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: WEB_CLIENT_ID,
        redirect_uri: location.origin + '/',
        response_type: 'token',
        scope: DRIVE_APPDATA_SCOPE,
        include_granted_scopes: 'true',
        state,
      }),
  );
  return new Promise<boolean>(() => {});
}

export const signOut = async () => {
  const s = saved();
  localStorage.removeItem(KEY);
  if (s) await fetch(`https://oauth2.googleapis.com/revoke?token=${s.token}`, { method: 'POST' }).catch(() => {});
};

export async function getAccessToken(): Promise<string> {
  const s = saved();
  if (!s) throw new Error('Google にサインインしていません（サインインの有効期限が切れた場合は、設定からもう一度サインインしてください）');
  return s.token;
}

export const discardAccessToken = async (token: string) => {
  if (saved()?.token === token) localStorage.removeItem(KEY);
};
