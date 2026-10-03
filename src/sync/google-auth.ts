import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import { DRIVE_APPDATA_SCOPE, IOS_CLIENT_ID, WEB_CLIENT_ID } from './config';

/** iOS は iOS 用クライアント ID が無いと設定自体が例外になる。未設定の間はサインインを利用不可として扱う */
export const googleAvailable = Platform.OS !== 'ios' || IOS_CLIENT_ID !== null;

if (googleAvailable) {
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID ?? undefined, scopes: [DRIVE_APPDATA_SCOPE] });
}

export const isSignedIn = () => googleAvailable && GoogleSignin.hasPreviousSignIn();
export const currentEmail = () => (googleAvailable ? (GoogleSignin.getCurrentUser()?.user.email ?? null) : null);

/** キャンセル時は false */
export async function signIn(): Promise<boolean> {
  if (!googleAvailable) throw new Error('この環境では Google サインインを設定していません（iOS 用クライアント ID が未設定）');
  await GoogleSignin.hasPlayServices();
  return (await GoogleSignin.signIn()).type === 'success';
}

export const signOut = () => GoogleSignin.signOut();

export async function getAccessToken(): Promise<string> {
  return (await GoogleSignin.getTokens()).accessToken;
}

export const discardAccessToken = async (token: string) => {
  await GoogleSignin.clearCachedAccessToken(token);
};
