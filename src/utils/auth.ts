// apps/backend/src/utils/auth.ts
import type { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload, type VerifyErrors, type JwtHeader, type SigningKeyCallback } from 'jsonwebtoken';
import jwksClient, { type JwksClient } from 'jwks-rsa';

const DISABLE_AUTH     = /^true$/i.test(process.env.DISABLE_AUTH || '');
const DEV_TENANT_ID    = process.env.DEV_TENANT_ID || '';
const DEFAULT_TENANT_ID= process.env.DEFAULT_TENANT_ID || '';
const JWT_SECRET       = process.env.JWT_SECRET || ''; // HS256 signing secret
const COGNITO_AUDIENCE = process.env.COGNITO_AUDIENCE;
const COOKIE_NAME      = process.env.COOKIE_NAME || 'session';

const isObjectId = (s?: string) => !!s && /^[0-9a-f]{24}$/i.test(s);
const looksJwt    = (s?: string | null) => !!s && typeof s === 'string' && s.split('.').length === 3;

/* ------------------------------ Cognito/JWKS ------------------------------ */
function cognitoIssuer(): string | undefined {
  if (process.env.COGNITO_ISSUER) return process.env.COGNITO_ISSUER;
  const region = process.env.COGNITO_REGION;
  const poolId = process.env.COGNITO_USER_POOL_ID;
  return region && poolId ? `https://cognito-idp.${region}.amazonaws.com/${poolId}` : undefined;
}

let jwks: JwksClient | null = null;
function getJwksClient(): JwksClient | null {
  if (jwks) return jwks;
  const issuer = cognitoIssuer();
  if (!issuer) return null;
  jwks = jwksClient({
    jwksUri: `${issuer}/.well-known/jwks.json`,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
  return jwks;
}
function getJwksKey(header: JwtHeader, cb: SigningKeyCallback) {
  const c = getJwksClient();
  if (!c) return cb(new Error('JWKS client not configured'));
  const kid = header.kid as string | undefined;
  if (!kid) return cb(new Error('Missing kid in token header'));
  c.getSigningKey(kid, (err, key) => {
    if (err) return cb(err as Error);
    const signingKey = (key as any).getPublicKey();
    cb(null, signingKey);
  });
}

/* --------------------------------- Types ---------------------------------- */
export interface AuthedPayload extends JwtPayload {
  sub?: string;
  email?: string;
  username?: string;
  'custom:tenantId'?: string;
}

/* -------------------------- Tenant Id enrichment -------------------------- */
function ensureTenantId(req: Request, payload: AuthedPayload): AuthedPayload {
  if (isObjectId(payload['custom:tenantId'])) return payload;
  const headerTid = req.header('x-tenant-id') || req.header('X-Tenant-Id') || '';
  if (isObjectId(headerTid)) { payload['custom:tenantId'] = headerTid; return payload; }
  if (isObjectId(DEFAULT_TENANT_ID)) { payload['custom:tenantId'] = DEFAULT_TENANT_ID; return payload; }
  if (isObjectId(DEV_TENANT_ID)) { payload['custom:tenantId'] = DEV_TENANT_ID; return payload; }
  return payload;
}

/* ------------------------------- Open paths ------------------------------- */
function isOpenPath(req: Request): boolean {
  if (req.method === 'OPTIONS') return true;
  if (req.path === '/health') return true;
  if (req.path.startsWith('/auth')) return true;
  return false;
}

/* --------------------------- Token extraction ----------------------------- */
function parseCookies(raw?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  raw.split(';').forEach((p) => {
    const [k, ...rest] = p.trim().split('=');
    if (!k) return;
    const v = rest.join('=');
    try { out[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
    catch { out[k] = v || ''; }
  });
  return out;
}
function cookieToken(req: Request): string | null {
  const c = parseCookies(req.headers.cookie || null);
  return (c[COOKIE_NAME] || c.jwt || c.token || c.access_token || c.idToken || c.IDToken || '').trim() || null;
}

/**
 * Prefer cookie (stable across tabs) and only fall back to Authorization header
 * if there is no cookie OR the header looks like a real JWT and the cookie is missing.
 */
function extractToken(req: Request): string | null {
  const cTok = cookieToken(req);
  const authz = (req.headers.authorization as string) || (req.headers as any).Authorization;

  if (cTok) return cTok;                         // ⬅️ cookie wins

  if (authz && /^Bearer\s+/i.test(authz)) {
    const t = authz.replace(/^Bearer\s+/i, '').trim();
    if (looksJwt(t)) return t;
  }

  // query fallback
  const qp =
    (req.query.token as string | undefined) ||
    (req.query.jwt as string | undefined) ||
    (req.query.access_token as string | undefined);
  if (typeof qp === 'string' && qp.trim()) return qp.trim();

  return null;
}

/* -------------------------------- Middleware ------------------------------ */
export default function auth(req: Request, res: Response, next: NextFunction) {
  if (isOpenPath(req)) return next();

  // Dev bypass
  if (DISABLE_AUTH) {
    (req as any).user = ensureTenantId(req, {
      sub: 'dev-user',
      email: 'dev@example.com',
      'custom:tenantId': isObjectId(DEV_TENANT_ID) ? DEV_TENANT_ID : undefined,
      iat: Math.floor(Date.now() / 1000),
    });
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, message: 'Missing Bearer token' });
  }

  const issuer = cognitoIssuer();

  // HS256 first-party
  if (JWT_SECRET) {
    const verifyOpts: jwt.VerifyOptions = {
      algorithms: ['HS256'],
      ...(COGNITO_AUDIENCE ? { audience: COGNITO_AUDIENCE } : {}),
    };
    jwt.verify(token, JWT_SECRET, verifyOpts, (err: VerifyErrors | null, decoded?: JwtPayload | string) => {
      if (err) return res.status(401).json({ ok: false, message: 'Invalid token', error: err.message });
      const payload: AuthedPayload =
        typeof decoded === 'string' ? (JSON.parse(decoded) as AuthedPayload) : ((decoded as AuthedPayload) || {});
      (req as any).user = ensureTenantId(req, payload);
      return next();
    });
    return;
  }

  // RS256 (Cognito/OIDC)
  if (issuer) {
    const verifyOpts: jwt.VerifyOptions = {
      algorithms: ['RS256'],
      issuer,
      ...(COGNITO_AUDIENCE ? { audience: COGNITO_AUDIENCE } : {}),
    };
    jwt.verify(token, getJwksKey, verifyOpts, (err: VerifyErrors | null, decoded?: JwtPayload | string) => {
      if (err) return res.status(401).json({ ok: false, message: 'Invalid token', error: err.message });
      const payload: AuthedPayload =
        typeof decoded === 'string' ? (JSON.parse(decoded) as AuthedPayload) : ((decoded as AuthedPayload) || {});
      (req as any).user = ensureTenantId(req, payload);
      return next();
    });
    return;
  }

  return res.status(401).json({
    ok: false,
    message:
      'Auth not configured. Set DISABLE_AUTH=true (dev only), or JWT_SECRET for HS256, or COGNITO_REGION+COGNITO_USER_POOL_ID / COGNITO_ISSUER for JWKS.',
  });
}
