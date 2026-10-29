import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const cookieName = 'evento_session';
const sessionDays = 30;

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new Error('A senha deve ter entre 12 e 200 caracteres.');
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [algorithm, saltText, hashText] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db, userId) {
  const token = newToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionDays * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, expiresAt, now.toISOString());
  return token;
}

export function sessionCookie(token, request) {
  const secure = process.env.COOKIE_SECURE === 'true' || request?.headers['x-forwarded-proto'] === 'https';
  const parts = [`${cookieName}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${sessionDays * 86400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(request) {
  const secure = process.env.COOKIE_SECURE === 'true' || request?.headers['x-forwarded-proto'] === 'https';
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function sessionTokenFromRequest(request) {
  const raw = request.headers.cookie || '';
  const found = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return found?.slice(cookieName.length + 1) || null;
}

export function authenticatedUser(db, request) {
  const token = sessionTokenFromRequest(request);
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.active = 1`)
    .get(tokenHash(token), new Date().toISOString());
  return row || null;
}

export function revokeSession(db, request) {
  const token = sessionTokenFromRequest(request);
  if (token) db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
    .run(new Date().toISOString(), tokenHash(token));
}
