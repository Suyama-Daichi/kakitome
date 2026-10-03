// Google Cloud のウェブ アプリケーション用 OAuth クライアント ID（公開情報。シークレットではない）。
// Android は パッケージ名 + 署名の SHA-1 で照合されるため、コードには現れない。
export const WEB_CLIENT_ID = '196889256232-irgrho6nl5s7rj9fber1j0mrtavkub15.apps.googleusercontent.com';
// 設計 §6.1: これ以外のスコープは要求しない
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// iOS 用 OAuth クライアント ID（Google Cloud で種類「iOS」・バンドル ID app.kakitome のもの）。
// 未作成の間は null。iOS では null のあいだ Google サインインを利用不可として扱う
export const IOS_CLIENT_ID: string | null = null;
