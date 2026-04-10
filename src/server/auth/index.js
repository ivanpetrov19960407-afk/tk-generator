'use strict';

const crypto = require('crypto');

const ROLES = {
  admin: 3,
  operator: 2,
  viewer: 1
};

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!ROLES[normalized]) throw new Error('Unknown role');
  return normalized;
}

function createAuth(config, repository) {
  const authConfig = (config && config.auth) || {};
  const enabled = Boolean(authConfig.enabled);
  const accessTtlSec = Number(authConfig.accessTokenTtlSec || 60 * 60);
  const refreshTtlSec = Number(authConfig.refreshTokenTtlSec || 7 * 24 * 60 * 60);

  const jwtSecret = authConfig.jwtSecret || process.env.TKG_AUTH_JWT_SECRET || null;
  if (enabled && (!jwtSecret || jwtSecret.length < 16)) {
    throw new Error('Auth enabled, but JWT secret is missing or too short. Set config.auth.jwtSecret or TKG_AUTH_JWT_SECRET.');
  }


  const loginRateLimit = {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000
  };
  const loginAttempts = new Map();

  function checkRateLimit(ip) {
    if (!ip) return { blocked: false };
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec) return { blocked: false };
    if (now - rec.firstAttemptAt > loginRateLimit.windowMs) {
      loginAttempts.delete(ip);
      return { blocked: false };
    }
    if (rec.count >= loginRateLimit.maxAttempts) return { blocked: true };
    return { blocked: false };
  }

  function registerFailedAttempt(ip) {
    if (!ip) return;
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || now - rec.firstAttemptAt > loginRateLimit.windowMs) {
      loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
      return;
    }
    rec.count += 1;
    loginAttempts.set(ip, rec);
  }

  function clearAttempts(ip) {
    if (!ip) return;
    loginAttempts.delete(ip);
  }

  function base64urlEncode(input) {
    return Buffer.from(input).toString('base64url');
  }

  function base64urlDecode(input) {
    return Buffer.from(input, 'base64url').toString('utf8');
  }

  function signToken(payload, ttlSec) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = { ...payload, iat: now, exp: now + Number(ttlSec) };
    const encodedHeader = base64urlEncode(JSON.stringify(header));
    const encodedPayload = base64urlEncode(JSON.stringify(tokenPayload));
    const data = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.createHmac('sha256', jwtSecret).update(data).digest('base64url');
    return `${data}.${signature}`;
  }

  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, signature] = parts;
    const data = `${encodedHeader}.${encodedPayload}`;
    const expected = crypto.createHmac('sha256', jwtSecret).update(data).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    let payload;
    try {
      payload = JSON.parse(base64urlDecode(encodedPayload));
    } catch {
      return null;
    }
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  }

  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  function verifyPassword(password, encodedHash) {
    const [algo, salt, hash] = String(encodedHash || '').split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  }

  async function ensureBootstrapAdmin() {
    if (!enabled) return;
    const total = repository.countUsers();
    if (total > 0) return;

    const username = process.env.TKG_AUTH_ADMIN_USERNAME || authConfig.bootstrapAdminUsername || 'admin';
    const envPassword = process.env.TKG_AUTH_ADMIN_PASSWORD || authConfig.bootstrapAdminPassword || null;
    const generatedPassword = crypto.randomBytes(12).toString('base64url');
    const password = envPassword || generatedPassword;

    await repository.createUser({
      username,
      passwordHash: hashPassword(password),
      role: 'admin'
    });

    console.log(`[auth] Bootstrap admin created: username="${username}", password="${password}"`);
  }

  function issueTokens(user) {
    const payload = { sub: String(user.id), username: user.username, role: user.role, type: 'access' };
    const refreshPayload = { sub: String(user.id), username: user.username, role: user.role, type: 'refresh' };
    const accessToken = signToken(payload, accessTtlSec);
    const refreshToken = signToken(refreshPayload, refreshTtlSec);
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessTtlSec,
      refreshExpiresIn: refreshTtlSec
    };
  }

  function decodeAccessTokenFromReq(req) {
    const header = req.headers.authorization || '';
    const match = String(header).match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const payload = verifyToken(match[1]);
    if (!payload || (payload.type && payload.type !== 'access')) return null;
    return payload;
  }

  async function authenticate(req) {
    if (!enabled) {
      req.auth = { enabled: false, user: null, role: 'admin' };
      return req.auth;
    }

    const tokenPayload = decodeAccessTokenFromReq(req);
    if (!tokenPayload || !tokenPayload.sub) {
      req.auth = { enabled: true, user: null, role: null };
      return req.auth;
    }

    const user = repository.getUserById(Number(tokenPayload.sub));
    if (!user || !user.is_active) {
      req.auth = { enabled: true, user: null, role: null };
      return req.auth;
    }

    req.auth = {
      enabled: true,
      user: { id: user.id, username: user.username, role: user.role },
      role: user.role
    };
    return req.auth;
  }

  function hasRole(userRole, minRole) {
    if (!minRole) return true;
    return (ROLES[userRole] || 0) >= (ROLES[minRole] || Number.MAX_SAFE_INTEGER);
  }

  async function requireRole(req, res, sendJson, minRole) {
    const auth = await authenticate(req);
    if (!enabled) return true;
    if (!auth.user) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return false;
    }
    if (!hasRole(auth.role, minRole)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return false;
    }
    return true;
  }

  async function login(username, password, ipAddress) {
    if (!enabled) throw new Error('Auth disabled');
    const rate = checkRateLimit(ipAddress);
    if (rate.blocked) return null;

    const user = repository.getUserByUsername(username);
    if (!user || !user.is_active) {
      registerFailedAttempt(ipAddress);
      return null;
    }

    const ok = verifyPassword(password, user.password_hash);
    if (!ok) {
      registerFailedAttempt(ipAddress);
      return null;
    }

    clearAttempts(ipAddress);
    repository.touchUserLogin(user.id);

    return {
      user: { id: user.id, username: user.username, role: user.role },
      tokens: issueTokens(user)
    };
  }

  async function register(requestingUser, payload) {
    if (!enabled) throw new Error('Auth disabled');
    if (!requestingUser || requestingUser.role !== 'admin') {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }

    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const role = normalizeRole(payload.role || 'viewer');

    if (username.length < 3) {
      const err = new Error('username must be at least 3 chars');
      err.statusCode = 400;
      throw err;
    }
    if (password.length < 8) {
      const err = new Error('password must be at least 8 chars');
      err.statusCode = 400;
      throw err;
    }
    if (repository.getUserByUsername(username)) {
      const err = new Error('User already exists');
      err.statusCode = 409;
      throw err;
    }

    const created = await repository.createUser({
      username,
      passwordHash: hashPassword(password),
      role
    });

    return { id: created.id, username: created.username, role: created.role };
  }

  return {
    enabled,
    ensureBootstrapAdmin,
    authenticate,
    requireRole,
    login,
    register
  };
}

module.exports = {
  ROLES,
  createAuth
};
