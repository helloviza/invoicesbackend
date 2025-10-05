// src/utils/auth.ts
import type { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload, type VerifyErrors, type JwtHeader, type SigningKeyCallback } from 'jsonwebtoken';
import jwksClient, { type JwksClient } from 'jwks-rsa';

const DISABLE_AUTH = /^true$/i.test(process.env.DISABLE_AUTH || '');
const DEV_TENANT_ID = process.env.DEV_TENANT_ID || '';
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '';
const JWT_SECRET = process.env.JWT_SECRET || ''; // for HS256 tokens (email/password login)
const COGNITO_AUDIENCE = process.env.COGNITO_AUDIENCE;

const isObjectId = (s?: string) => !!s && /^[0-9a-f]{24}$/i.test(s);

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
    cacheMaxAge: 10 * 60 * 1000, // 10m
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

export interface AuthedPayload extends JwtPayload {
  sub?: string;
  email?: string;
  username?: string;
  'custom:tenantId'?: string;
}

/**
 * Try to ensure a tenant id is present on the request user object.
 * Prefers header X-Tenant-Id, then DEFAULT_TENANT_ID, then DEV_TENANT_ID.
 */
function ensureTenantId(req: Request, payload: AuthedPayload): AuthedPayload {
  if (isObjectId(payload['custom:tenantId'])) return payload;

  const headerTid = req.header('x-tenant-id') || req.header('X-Tenant-Id') || '';
  if (isObjectId(headerTid)) {
    payload['custom:tenantId'] = headerTid;
    return payload;
  }
  if (isObjectId(DEFAULT_TENANT_ID)) {
    payload['custom:tenantId'] = DEFAULT_TENANT_ID;
    return payload;
  }
  if (isObjectId(DEV_TENANT_ID)) {
    payload['custom:tenantId'] = DEV_TENANT_ID;
    return payload;
  }
  // Leave missing; downstream will reject via resolveTenantId
  return payload;
}

function isOpenPath(req: Request): boolean {
  // server.ts mounts at /api, so here req.path is relative to /api
  if (req.method === 'OPTIONS') return true;
  if (req.path === '/health') return true;      // /api/health is mounted outside anyway; safe guard
  if (req.path.startsWith('/auth')) return true; // login/register/refresh etc
  return false;
}

export default function auth(req: Request, res: Response, next: NextFunction) {
  if (isOpenPath(req)) return next();

  // 1) Local dev bypass
  if (DISABLE_AUTH) {
    (req as any).user = ensureTenantId(req, {
      sub: 'dev-user',
      email: 'dev@example.com',
      'custom:tenantId': isObjectId(DEV_TENANT_ID) ? DEV_TENANT_ID : undefined,
      iat: Math.floor(Date.now() / 1000),
    });
    return next();
  }

  // 2) Extract Bearer token
  const authz = req.headers.authorization;
  if (!authz || !authz.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, message: 'Missing Bearer token' });
  }
  const token = authz.slice(7);

  // 3) Choose verification strategy
  const issuer = cognitoIssuer();

  // 3a) First-party HS256 (JWT_SECRET)
  if (JWT_SECRET) {
    const verifyOpts: jwt.VerifyOptions = {
      algorithms: ['HS256'],
      ...(COGNITO_AUDIENCE ? { audience: COGNITO_AUDIENCE } : {}),
      // no issuer on HS256 unless you set one in your login code
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

  // 3b) Cognito / OIDC with RS256 JWKS
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

  // 3c) No strategy configured -> fail closed with a helpful message
  return res.status(401).json({
    ok: false,
    message:
      'Auth not configured. Set DISABLE_AUTH=true (dev only), or JWT_SECRET for HS256, or COGNITO_REGION+COGNITO_USER_POOL_ID / COGNITO_ISSUER for JWKS.',
  });
}
