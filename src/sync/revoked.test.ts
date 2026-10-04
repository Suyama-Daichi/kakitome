import { isRevokedError } from './revoked';

describe('isRevokedError', () => {
  it('許可の取り消しは true', () => {
    expect(isRevokedError(new Error('RNGoogleSignIn: ... "invalid_grant: Token has been expired or revoked."'))).toBe(true);
    expect(isRevokedError('Token has been revoked')).toBe(true);
  });
  it('オフラインなど一時的な失敗は false', () => {
    expect(isRevokedError(new Error('Network request failed'))).toBe(false);
    expect(isRevokedError(new Error('Google にサインインしていません'))).toBe(false);
  });
});
