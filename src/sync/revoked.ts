/** Google が「許可が取り消された」と返したか。オフラインなどの一時的な失敗と区別するため、明確な文言だけを見る */
export const isRevokedError = (e: unknown) => /invalid_grant|revoked/i.test(e instanceof Error ? e.message : String(e));

export const REVOKED_MESSAGE = 'Google のサインインが取り消されています。設定からもう一度サインインしてください';
