import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { DRIVE_APPDATA_SCOPE, WEB_CLIENT_ID } from './config';

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: [DRIVE_APPDATA_SCOPE] });

export const isSignedIn = () => GoogleSignin.hasPreviousSignIn();
export const currentEmail = () => GoogleSignin.getCurrentUser()?.user.email ?? null;

/** キャンセル時は false */
export async function signIn(): Promise<boolean> {
  await GoogleSignin.hasPlayServices();
  return (await GoogleSignin.signIn()).type === 'success';
}

export const signOut = () => GoogleSignin.signOut();

export async function getAccessToken(): Promise<string> {
  return (await GoogleSignin.getTokens()).accessToken;
}
