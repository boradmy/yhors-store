require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PATH = '/yhors/admin593';

// YHORS puede trabajar con almacenamiento persistente sin cambiar la lógica del catálogo.
// En Render, configura YHORS_STORAGE_DIR=/var/data/yhors y monta un Persistent Disk en /var/data.
// Si la variable no existe, se conserva el comportamiento local original usando ./data y ./uploads.
const STORAGE_ROOT = process.env.YHORS_STORAGE_DIR
  ? path.resolve(process.env.YHORS_STORAGE_DIR)
  : path.join(__dirname, 'data');
const DATA_DIR = process.env.YHORS_STORAGE_DIR ? path.join(STORAGE_ROOT, 'data') : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'products.json');
const STOREFRONT_FILE = path.join(DATA_DIR, 'storefront.json');
const CLASSIFICATIONS_FILE = path.join(DATA_DIR, 'classifications.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOADS_DIR = process.env.YHORS_STORAGE_DIR ? path.join(STORAGE_ROOT, 'uploads') : path.join(__dirname, 'uploads');
const BACKUPS_DIR = process.env.YHORS_STORAGE_DIR ? path.join(STORAGE_ROOT, 'backups') : path.join(__dirname, 'data', 'backups');
const BACKUP_RETENTION = Math.max(3, Math.min(100, Number.parseInt(process.env.YHORS_BACKUP_RETENTION || '30', 10) || 30));
const AUTO_BACKUP_INTERVAL_MS = Math.max(60 * 60 * 1000, Number.parseInt(process.env.YHORS_AUTO_BACKUP_INTERVAL_HOURS || '6', 10) * 60 * 60 * 1000 || 6 * 60 * 60 * 1000);
const SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('[YHORS V14.1] SESSION_SECRET debe existir y tener al menos 32 caracteres.');
}
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const WEBAUTHN_RP_ID = (() => { try { return new URL(PUBLIC_BASE_URL || 'http://localhost:3000').hostname; } catch { return 'localhost'; } })();
const WEBAUTHN_ORIGIN = PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

const SECURITY_FILE = path.join(DATA_DIR, 'security.json');
// Seguridad V14.1: TOTP, rate limiting y sesiones server-side.
const TWO_FACTOR_ISSUER = 'YHORS-STORE';
const TWO_FACTOR_STEP_SECONDS = 30;
const TWO_FACTOR_DIGITS = 6;
const TWO_FACTOR_WINDOW = 1;
const TWO_FACTOR_SECRET_KEY = crypto.createHash('sha256').update(`${SESSION_SECRET}|YHORS-V14-2FA`, 'utf8').digest();
const LOGIN_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT_MAX_ATTEMPTS = 5;
const LOGIN_IP_LIMIT_MAX_ATTEMPTS = 100;
const ACCOUNT_LOGIN_ATTEMPTS_BEFORE_LOCK = 4;
const ACCOUNT_LOCKOUT_STAGES_MS = [3 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000];
const loginAttempts = new Map();
const pendingTwoFactor = new Map();
const pendingWebAuthn = new Map();
const SESSION_TTL_MS = Math.max(30 * 60 * 1000, Number.parseInt(process.env.SESSION_TTL_MINUTES || '720', 10) * 60 * 1000);
const SESSION_COOKIE = 'yhors_session';
const sessions = new Map();

// V10: cifrado de datos personales de pedidos en reposo.
// La clave NUNCA se guarda en el repositorio ni dentro de orders.json.
const YHORS_DATA_KEY_SECRET = String(process.env.YHORS_DATA_KEY || '').trim();
if (!YHORS_DATA_KEY_SECRET) {
  throw new Error('[YHORS V10] Falta YHORS_DATA_KEY. Configura una clave secreta de cifrado en .env (local) o en las variables de entorno de Render.');
}
const YHORS_DATA_KEY = crypto.createHash('sha256').update(YHORS_DATA_KEY_SECRET, 'utf8').digest();
const YHORS_DATA_KEY_FINGERPRINT = crypto.createHash('sha256').update(YHORS_DATA_KEY).digest('hex').slice(0, 16);
const ORDER_ENCRYPTION_PREFIX = 'YHORS1';
const ENCRYPTED_ORDER_CUSTOMER_FIELDS = ['name', 'phone', 'cedula', 'email', 'city', 'address', 'mapsUrl', 'notes'];
const ENCRYPTED_ORDER_TOP_LEVEL_FIELDS = ['internalNote'];

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(`${ORDER_ENCRYPTION_PREFIX}.`);
}

function encodeBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(String(value), 'base64url');
}

function encryptOrderValue(value) {
  if (value === null || value === undefined || value === '') return value ?? '';
  if (isEncryptedValue(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', YHORS_DATA_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ORDER_ENCRYPTION_PREFIX}.${encodeBase64Url(iv)}.${encodeBase64Url(tag)}.${encodeBase64Url(ciphertext)}`;
}

function decryptOrderValue(value) {
  if (value === null || value === undefined || value === '') return value ?? '';
  if (!isEncryptedValue(value)) return value;
  const parts = String(value).split('.');
  if (parts.length !== 4) throw new Error('Dato de pedido cifrado con formato inválido.');
  const [, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', YHORS_DATA_KEY, decodeBase64Url(ivEncoded));
    decipher.setAuthTag(decodeBase64Url(tagEncoded));
    return Buffer.concat([decipher.update(decodeBase64Url(ciphertextEncoded)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('No se pudo descifrar la información del pedido. Verifica YHORS_DATA_KEY.');
  }
}

function encryptOrder(order) {
  const protectedOrder = { ...order };
  const customer = { ...(order?.customer || {}) };
  for (const field of ENCRYPTED_ORDER_CUSTOMER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(customer, field)) customer[field] = encryptOrderValue(customer[field]);
  }
  protectedOrder.customer = customer;
  for (const field of ENCRYPTED_ORDER_TOP_LEVEL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(protectedOrder, field)) protectedOrder[field] = encryptOrderValue(protectedOrder[field]);
  }
  return protectedOrder;
}

function decryptOrder(order) {
  const readableOrder = { ...order };
  const customer = { ...(order?.customer || {}) };
  for (const field of ENCRYPTED_ORDER_CUSTOMER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(customer, field)) customer[field] = decryptOrderValue(customer[field]);
  }
  readableOrder.customer = customer;
  for (const field of ENCRYPTED_ORDER_TOP_LEVEL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(readableOrder, field)) readableOrder[field] = decryptOrderValue(readableOrder[field]);
  }
  return readableOrder;
}

function ordersNeedEncryption(orders) {
  return orders.some(order => ENCRYPTED_ORDER_CUSTOMER_FIELDS.some(field => Object.prototype.hasOwnProperty.call(order?.customer || {}, field) && order.customer[field] && !isEncryptedValue(order.customer[field]))
    || ENCRYPTED_ORDER_TOP_LEVEL_FIELDS.some(field => Object.prototype.hasOwnProperty.call(order, field) && order[field] && !isEncryptedValue(order[field])));
}

function writeProtectedOrdersDirect(ordersFile, orders) {
  const temporaryFile = `${ordersFile}.v10.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(orders.map(encryptOrder), null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, ordersFile);
}

function migrateOrdersFileToEncryption(ordersFile) {
  if (!fs.existsSync(ordersFile)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    if (!Array.isArray(parsed) || !ordersNeedEncryption(parsed)) return false;
    writeProtectedOrdersDirect(ordersFile, parsed);
    return true;
  } catch (error) {
    throw new Error(`[YHORS V10] No se pudo migrar ${ordersFile} al cifrado: ${error.message}`);
  }
}

function migrateAllOrderStorageToEncryption() {
  // Migra el archivo principal sin crear antes un backup en texto plano.
  const migratedMain = migrateOrdersFileToEncryption(ORDERS_FILE);
  let migratedBackups = 0;
  if (fs.existsSync(BACKUPS_DIR)) {
    for (const entry of fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^YHORS-\d{8}-\d{6}Z-[a-f0-9]{6}$/.test(entry.name)) continue;
      const backupOrdersFile = path.join(BACKUPS_DIR, entry.name, 'data', 'orders.json');
      if (migrateOrdersFileToEncryption(backupOrdersFile)) migratedBackups += 1;
    }
  }
  if (migratedMain || migratedBackups) {
    console.log(`[YHORS V10] Cifrado activado. Pedidos migrados: principal=${migratedMain ? 'sí' : 'no'}, backups=${migratedBackups}.`);
  }
}


const USER_ROLES = new Set(['admin', 'orders', 'store_manager']);


function readSecurity() {
  if (!fs.existsSync(SECURITY_FILE)) return { twoFactor: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(SECURITY_FILE, 'utf8'));
    return parsed && typeof parsed === 'object'
      ? { twoFactor: parsed.twoFactor && typeof parsed.twoFactor === 'object' ? parsed.twoFactor : {}, passkeys: parsed.passkeys && typeof parsed.passkeys === 'object' ? parsed.passkeys : {}, passkeyPolicy: parsed.passkeyPolicy && typeof parsed.passkeyPolicy === 'object' ? parsed.passkeyPolicy : {}, loginProtection: parsed.loginProtection && typeof parsed.loginProtection === 'object' ? parsed.loginProtection : {} }
      : { twoFactor: {}, passkeys: {}, passkeyPolicy: {}, loginProtection: {} };
  } catch {
    return { twoFactor: {}, passkeys: {}, passkeyPolicy: {} };
  }
}

function writeSecurity(value) {
  const tmp = `${SECURITY_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, SECURITY_FILE);
}

function ensureSecurityFile() {
  if (!fs.existsSync(SECURITY_FILE)) writeSecurity({ twoFactor: {}, passkeys: {}, passkeyPolicy: {}, loginProtection: {} });
}

function readPasskeyStore() {
  const security = readSecurity();
  return {
    passkeys: security.passkeys && typeof security.passkeys === 'object' ? security.passkeys : {},
    passkeyPolicy: security.passkeyPolicy && typeof security.passkeyPolicy === 'object' ? security.passkeyPolicy : {}
  };
}

function writePasskeyStore(store) {
  const security = readSecurity();
  security.passkeys = store.passkeys || {};
  security.passkeyPolicy = store.passkeyPolicy || {};
  writeSecurity(security);
}

function accountPasskeys(accountId) { return readPasskeyStore().passkeys[String(accountId)] || []; }
function passkeyAllowed(accountId) {
  const store = readPasskeyStore();
  return store.passkeyPolicy[String(accountId)] !== false;
}
function publicPasskeys(accountId) {
  return accountPasskeys(accountId).map(item => ({ id: item.id, name: item.name, createdAt: item.createdAt, lastUsedAt: item.lastUsedAt || null, deviceType: item.deviceType || null, backedUp: Boolean(item.backedUp), transports: item.transports || [] }));
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Secreto 2FA inválido.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function encryptTwoFactorSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', TWO_FACTOR_SECRET_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `V14.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptTwoFactorSecret(value) {
  if (!String(value || '').startsWith('V14.')) return '';
  try {
    const [, iv, tag, ciphertext] = String(value).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', TWO_FACTOR_SECRET_KEY, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(TWO_FACTOR_DIGITS, '0');
}

function verifyTotp(secret, code) {
  const cleanCode = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const currentCounter = Math.floor(Date.now() / 1000 / TWO_FACTOR_STEP_SECONDS);
  for (let offset = -TWO_FACTOR_WINDOW; offset <= TWO_FACTOR_WINDOW; offset += 1) {
    const expected = hotp(secret, currentCounter + offset);
    if (crypto.timingSafeEqual(Buffer.from(cleanCode), Buffer.from(expected))) return true;
  }
  return false;
}

function twoFactorRecord(accountId) {
  const security = readSecurity();
  return security.twoFactor[String(accountId)] || null;
}

function accountTwoFactorEnabled(accountId) {
  const record = twoFactorRecord(accountId);
  return Boolean(record?.enabled && record?.secret);
}

function setTwoFactorRecord(accountId, record) {
  const security = readSecurity();
  if (record) security.twoFactor[String(accountId)] = record;
  else delete security.twoFactor[String(accountId)];
  writeSecurity(security);
}

function createTwoFactorSetup(accountId, username) {
  const secret = base32Encode(crypto.randomBytes(20));
  const label = `${TWO_FACTOR_ISSUER}:${username}`;
  const otpauthUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(TWO_FACTOR_ISSUER)}&algorithm=SHA1&digits=${TWO_FACTOR_DIGITS}&period=${TWO_FACTOR_STEP_SECONDS}`;
  setTwoFactorRecord(accountId, {
    enabled: false,
    pendingSecret: encryptTwoFactorSecret(secret),
    updatedAt: new Date().toISOString()
  });
  return { secret, otpauthUri };
}

function enableTwoFactor(accountId, username, code) {
  const record = twoFactorRecord(accountId);
  const secret = decryptTwoFactorSecret(record?.pendingSecret);
  if (!secret || !verifyTotp(secret, code)) return false;
  setTwoFactorRecord(accountId, {
    enabled: true,
    secret: encryptTwoFactorSecret(secret),
    pendingSecret: '',
    username,
    updatedAt: new Date().toISOString()
  });
  return true;
}

function disableTwoFactor(accountId) {
  setTwoFactorRecord(accountId, null);
}

function clearExpiredTwoFactorChallenges() {
  const now = Date.now();
  for (const [token, challenge] of pendingTwoFactor) {
    if (challenge.expiresAt <= now) pendingTwoFactor.delete(token);
  }
}
setInterval(clearExpiredTwoFactorChallenges, 60 * 1000).unref();

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 120);
}

function rateLimitKey(ip, username, scope = 'login') {
  return `${scope}:${ip}:${String(username || '').toLowerCase()}`;
}

function isRateLimited(key, maxAttempts) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= now) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= maxAttempts;
}

function registerFailedAttempt(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_LIMIT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearFailedAttempts(ip, username) {
  loginAttempts.delete(rateLimitKey(ip, username));
  loginAttempts.delete(`login-ip:${ip}`);
}

function loginProtectionRecord(accountId) {
  const security = readSecurity();
  const raw = security.loginProtection[String(accountId)];
  if (!raw || typeof raw !== 'object') return { failures: 0, stage: 0, lockedUntil: 0, permanentlyLocked: false };
  return {
    failures: Math.max(0, Number.parseInt(raw.failures || 0, 10) || 0),
    stage: Math.max(0, Number.parseInt(raw.stage || 0, 10) || 0),
    lockedUntil: Math.max(0, Number.parseInt(raw.lockedUntil || 0, 10) || 0),
    permanentlyLocked: raw.permanentlyLocked === true
  };
}

function writeLoginProtection(accountId, record) {
  const security = readSecurity();
  if (!security.loginProtection || typeof security.loginProtection !== 'object') security.loginProtection = {};
  security.loginProtection[String(accountId)] = { ...record, updatedAt: new Date().toISOString() };
  writeSecurity(security);
}

function clearLoginProtection(accountId) {
  const security = readSecurity();
  if (security.loginProtection && Object.prototype.hasOwnProperty.call(security.loginProtection, String(accountId))) {
    delete security.loginProtection[String(accountId)];
    writeSecurity(security);
  }
}

function loginProtectionStatus(accountId) {
  const record = loginProtectionRecord(accountId);
  const now = Date.now();
  if (record.permanentlyLocked) return { locked: true, permanent: true, remainingSeconds: 0, failures: record.failures, stage: record.stage };
  if (record.lockedUntil > now) return { locked: true, permanent: false, remainingSeconds: Math.ceil((record.lockedUntil - now) / 1000), failures: record.failures, stage: record.stage };
  if (record.lockedUntil && record.lockedUntil <= now) {
    record.lockedUntil = 0;
    record.failures = 0;
    writeLoginProtection(accountId, record);
  }
  return { locked: false, permanent: false, remainingSeconds: 0, failures: record.failures, stage: record.stage };
}

function registerAccountPasswordFailure(accountId) {
  const record = loginProtectionRecord(accountId);
  const now = Date.now();
  if (record.permanentlyLocked) return loginProtectionStatus(accountId);
  if (record.lockedUntil > now) return loginProtectionStatus(accountId);
  if (record.lockedUntil && record.lockedUntil <= now) record.lockedUntil = 0;
  if (record.failures < ACCOUNT_LOGIN_ATTEMPTS_BEFORE_LOCK) {
    record.failures += 1;
    writeLoginProtection(accountId, record);
    return { locked: false, permanent: false, remainingSeconds: 0, failures: record.failures, stage: record.stage, attemptsRemaining: ACCOUNT_LOGIN_ATTEMPTS_BEFORE_LOCK - record.failures };
  }
  if (record.stage >= ACCOUNT_LOCKOUT_STAGES_MS.length) {
    record.permanentlyLocked = true;
    record.lockedUntil = 0;
    writeLoginProtection(accountId, record);
    return { locked: true, permanent: true, remainingSeconds: 0, failures: record.failures, stage: record.stage };
  }
  const duration = ACCOUNT_LOCKOUT_STAGES_MS[record.stage];
  record.stage += 1;
  record.failures = 0;
  record.lockedUntil = now + duration;
  writeLoginProtection(accountId, record);
  return { locked: true, permanent: false, remainingSeconds: Math.ceil(duration / 1000), failures: 0, stage: record.stage };
}

function rateLimitResponse(res, resetAt) {
  const seconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader('Retry-After', String(seconds));
  return res.status(429).json({
    error: `Demasiados intentos. Intenta nuevamente en ${Math.ceil(seconds / 60)} minuto(s).`,
    retryAfterSeconds: seconds
  });
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '').slice(0, 40);
}

function normalizeUserName(value) {
  return cleanText(value, 100);
}

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
}

function ensureUserSeed(users, username, name, password, role) {
  const normalized = normalizeUsername(username);
  if (!normalized || !password || !USER_ROLES.has(role)) return users;
  const existing = users.find(user => user.username === normalized);
  if (existing) return users;
  users.push({
    id: crypto.randomUUID(),
    name: normalizeUserName(name) || normalized,
    username: normalized,
    passwordHash: bcrypt.hashSync(String(password), 12),
    role,
    active: true,
    system: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return users;
}

function ensureUsers() {
  let users = readUsers();
  const before = JSON.stringify(users);
  users = ensureUserSeed(users, ADMIN_USER, 'Administrador principal', ADMIN_PASSWORD, 'admin');

  // Migración: elimina la antigua cuenta del sistema "ventas" / "Ventas / Pedidos".
  // Ya no se vuelve a crear desde variables de entorno.
  users = users.filter(user => !(user.system && user.username === 'ventas' && user.role === 'orders'));

  // Si el archivo ya existía con una cuenta del sistema, mantenemos sus datos.
  // La sincronización con .env solo ocurre cuando esa cuenta todavía no existe.
  if (JSON.stringify(users) !== before || !fs.existsSync(USERS_FILE)) writeUsers(users);
  return users;
}

function findUserByUsername(username) {
  const normalized = normalizeUsername(username);
  return readUsers().find(user => user.username === normalized && user.active !== false) || null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active !== false,
    system: Boolean(user.system),
    twoFactorEnabled: accountTwoFactorEnabled(user.id),
    passkeyEnabled: passkeyAllowed(user.id) && accountPasskeys(user.id).length > 0,
    passkeyAllowed: passkeyAllowed(user.id),
    passkeyCount: accountPasskeys(user.id).length,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function validateNewUser(input, users, currentId = '') {
  const name = normalizeUserName(input?.name);
  const username = normalizeUsername(input?.username);
  const password = String(input?.password || '');
  const role = String(input?.role || 'orders').trim().toLowerCase();
  const active = input?.active !== false;

  if (name.length < 2) return { error: 'Ingresa el nombre del usuario.' };
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return { error: 'El usuario debe tener entre 3 y 40 caracteres y usar solo letras, números, punto, guion o guion bajo.' };
  if (!USER_ROLES.has(role)) return { error: 'Rol de usuario no válido.' };
  if (password && (password.length < 8 || password.length > 200)) return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  const duplicate = users.find(user => user.username === username && user.id !== currentId);
  if (duplicate) return { error: 'Ese nombre de usuario ya existe.' };
  return { user: { name, username, role, active, password } };
}

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  ensureUsers();
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  ensureSecurityFile();

  // Primera ejecución con disco vacío: copia los datos que viajan con el código.
  // Nunca sobrescribe un archivo que ya exista en el almacenamiento persistente.
  if (process.env.YHORS_STORAGE_DIR) {
    const seedFiles = ['products.json', 'storefront.json', 'classifications.json', 'orders.json', 'users.json', 'security.json'];
    for (const fileName of seedFiles) {
      const source = path.join(__dirname, 'data', fileName);
      const target = path.join(DATA_DIR, fileName);
      if (!fs.existsSync(target) && fs.existsSync(source)) fs.copyFileSync(source, target);
    }
    const bundledUploads = path.join(__dirname, 'uploads');
    if (fs.existsSync(bundledUploads)) {
      for (const fileName of fs.readdirSync(bundledUploads)) {
        const source = path.join(bundledUploads, fileName);
        const target = path.join(UPLOADS_DIR, fileName);
        if (fileName === '.gitkeep' || !fs.statSync(source).isFile()) continue;
        if (!fs.existsSync(target)) fs.copyFileSync(source, target);
      }
    }
  }

  for (const fileName of ['products.json', 'storefront.json', 'classifications.json', 'orders.json']) {
    const target = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(target)) fs.writeFileSync(target, fileName === 'orders.json' ? '[]\n' : fileName === 'products.json' ? '[]\n' : fileName === 'storefront.json' ? '{\n  "heroProductIds": [],\n  "featuredProductIds": []\n}\n' : '{\n  "brands": {},\n  "productTypes": {}\n}\n', 'utf8');
  }
}
ensureStorage();
migrateAllOrderStorageToEncryption();
setTimeout(() => maybeAutoBackup(), 1500);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());


const SITE_URL = String(process.env.PUBLIC_BASE_URL || 'https://yhors-store.onrender.com').replace(/\/$/, '');
const SITE_NAME = 'YHORS-STORE';
const CORPORATE_NAME = 'YHORS-CORP';
const CATEGORY_LABELS = {
  principal: 'Principal', elegant: 'Elegant', sports: 'Sports', tech: 'Tech', cosplay: 'Cosplay',
  pets: 'Pets', details: 'Details', collectibles: 'Coleccionables'
};
const CATEGORY_DESCRIPTIONS = {
  principal: 'Descubre todo el universo YHORS en un solo lugar.',
  elegant: 'Detalles refinados, regalos y piezas pensadas para momentos especiales.',
  sports: 'Accesorios y productos para quienes viven con energía y movimiento.',
  tech: 'Tecnología, gadgets y soluciones que combinan utilidad con estilo.',
  cosplay: 'Piezas para transformar tu personaje y llevar tu imaginación más lejos.',
  pets: 'Detalles y productos para consentir a quienes siempre están contigo.',
  details: 'Regalos, arreglos y detalles creados para sorprender.',
  collectibles: 'Figuras y objetos para quienes disfrutan coleccionar lo extraordinario.'
};
const VALID_PUBLIC_CATEGORIES = Object.keys(CATEGORY_LABELS).filter(key => key !== 'principal');
function seoSlug(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'producto';
}
function productSlug(product) {
  const base = seoSlug(product.name);
  const sku = seoSlug(product.sku || '');
  return sku ? `${base}-${sku}` : `${base}-${String(product.id || '').slice(0, 8)}`;
}
function productUrl(product) { return `${SITE_URL}/producto/${encodeURIComponent(productSlug(product))}`; }
function findProductBySlug(products, slug) {
  const target = decodeURIComponent(String(slug || '')).toLowerCase();
  return products.find(product => productSlug(product).toLowerCase() === target);
}
function esc(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function stripText(value = '') { return String(value).replace(/\s+/g, ' ').trim(); }
function absoluteImage(value = '') {
  if (!value) return `${SITE_URL}/favicon.svg`;
  return value.startsWith('http') ? value : `${SITE_URL}${value.startsWith('/') ? '' : '/'}${value}`;
}
function seoDescription(text, fallback) {
  const clean = stripText(text || fallback);
  return clean.length > 155 ? `${clean.slice(0, 152).replace(/\s+\S*$/, '')}…` : clean;
}
function jsonLd(value) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
function baseHead({ title, description, canonical, robots = 'index,follow', image = '', json = [] }) {
  const graph = Array.isArray(json) ? json : [json];
  return `
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="${esc(robots)}">
    <link rel="canonical" href="${esc(canonical)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${SITE_NAME}">
    <meta property="og:locale" content="es_EC">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${esc(canonical)}">
    ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    ${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
    ${graph.map(item => `<script type="application/ld+json">${jsonLd(item)}</script>`).join('\n')}
  `;
}
function layout({ title, description, canonical, body, robots, image, json }) {
  const template = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const head = baseHead({ title, description, canonical, robots, image, json });
  return template.replace('<meta name="description" content="YHORS · piezas que cuentan tu historia.">', head)
    .replace('<title>YHORS-STORE</title>', `<title>${esc(title)}</title>`)
    .replace('<div id="app"></div>', `<div id="app">${body}</div>`);
}
function productSeoBody(product) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  const image = images[0] || '';
  const category = CATEGORY_LABELS[product.category] || product.category;
  const price = Number(product.salePrice ?? product.price);
  const rental = product.category === 'cosplay' && Number.isFinite(Number(product.rentalPrice)) ? `<p class="price-secondary">Alquiler: $${Number(product.rentalPrice).toFixed(2)}</p>` : '';
  return `<main class="product-detail-page"><div class="breadcrumbs"><a href="/categoria/${encodeURIComponent(product.category)}">${esc(category)}</a><span>/</span><strong>${esc(product.name)}</strong></div><section class="detail-layout"><div class="detail-gallery"><div class="detail-main-image"><img src="${esc(absoluteImage(image))}" alt="${esc(product.name)}" width="800" height="800"></div>${images.length > 1 ? `<div class="thumbnail-row">${images.slice(1,4).map((url,i)=>`<img src="${esc(absoluteImage(url))}" alt="${esc(product.name)} - imagen ${i+2}" width="200" height="200">`).join('')}</div>`:''}</div><div class="detail-copy"><span class="eyebrow">${esc(category)}</span><h1>${esc(product.name)}</h1><div class="detail-price">$${price.toFixed(2)}</div>${rental}<div class="detail-sku"><span>SKU: <strong>${esc(product.sku || '—')}</strong></span></div><div class="detail-divider"></div><h2>Descripción</h2><div class="detail-description">${esc(product.description).replace(/\n/g,'<br>')}</div><div class="detail-buy"><a class="button" href="/categoria/${encodeURIComponent(product.category)}">Ver más productos <span>→</span></a></div></div></section></main>`;
}
function categorySeoBody(categoryKey, products) {
  const label = CATEGORY_LABELS[categoryKey];
  const list = products.filter(p => categoryKey === 'principal' || p.category === categoryKey);
  return `<main><section class="section category-page-section"><div class="category-intro"><div><span class="eyebrow">YHORS-STORE</span><h1>${esc(label)}</h1></div><p>${esc(CATEGORY_DESCRIPTIONS[categoryKey])}</p></div><section class="section"><div class="products">${list.map(p => `<article class="product"><a class="product-open" href="${esc(productUrl(p))}"><div class="product-image"><img src="${esc(absoluteImage((p.images||[])[0]||p.image))}" alt="${esc(p.name)}" width="800" height="800"></div><div class="product-info"><span class="product-category">${esc(CATEGORY_LABELS[p.category] || p.category)}</span><h2>${esc(p.name)}</h2><p>${esc(seoDescription(p.description, p.name))}</p><span class="detail-link">Ver detalles →</span></div></a></article>`).join('')}</div></section></section></main>`;
}
function homeSeoBody(products) {
  const featured = products.filter(p => p.featured).slice(0, 12);
  const items = (featured.length ? featured : products).slice(0, 12);
  return `<main><section class="hero-slider"><div class="hero-content"><span class="eyebrow">YHORS-STORE</span><h1>Tecnología, detalles y piezas que cuentan tu historia.</h1><p>Descubre el catálogo YHORS: tecnología, regalos, cosplay, mascotas, coleccionables y productos seleccionados.</p><a class="button" href="/categoria/principal">Explorar catálogo <span>→</span></a></div></section><section class="section"><div class="section-heading"><div><span class="eyebrow">Selección YHORS</span><h2>Productos destacados</h2></div><p>Explora productos disponibles en nuestra tienda online.</p></div><div class="products">${items.map(p=>`<article class="product"><a class="product-open" href="${esc(productUrl(p))}"><div class="product-image"><img src="${esc(absoluteImage((p.images||[])[0]||p.image))}" alt="${esc(p.name)}" width="800" height="800"></div><div class="product-info"><span class="product-category">${esc(CATEGORY_LABELS[p.category]||p.category)}</span><h2>${esc(p.name)}</h2><p>${esc(seoDescription(p.description,p.name))}</p><span class="detail-link">Ver detalles →</span></div></a></article>`).join('')}</div></section><section class="section category-blocks"><div class="section-heading"><div><span class="eyebrow">Explora por universo</span><h2>Categorías YHORS</h2></div></div><div class="category-grid">${Object.entries(CATEGORY_LABELS).filter(([k])=>k!=='principal').map(([k,v])=>`<a class="category-card" href="/categoria/${k}"><h2>${esc(v)}</h2><p>${esc(CATEGORY_DESCRIPTIONS[k])}</p></a>`).join('')}</div></section><section class="brand-section"><div class="brand-section-inner"><span class="eyebrow">YHORS-CORP</span><h2>YHORS<br><em>más que un producto</em></h2><p>YHORS-CORP es el espacio corporativo de la marca YHORS y su ecosistema digital, mientras YHORS-STORE presenta el catálogo de productos.</p><a class="button" href="/yhors-corp">Conocer YHORS-CORP <span>→</span></a></div></section></main>`;
}
function corpSeoBody() {
  return `<main class="section"><div class="brand-section-inner"><span class="eyebrow">YHORS-CORP</span><h1>YHORS-CORP</h1><p>Espacio corporativo de YHORS y punto de referencia para conocer el ecosistema de la marca.</p><h2>YHORS-STORE</h2><p>YHORS-STORE es la tienda online de YHORS, con un catálogo de tecnología, detalles, cosplay, mascotas, coleccionables y otros productos seleccionados.</p><a class="button" href="/">Visitar YHORS-STORE <span>→</span></a></div></main>`;
}

// SEO public files are served explicitly so crawler access is independent of the static/admin middleware.
app.get('/robots.txt', (_, res) => {
  res.status(200)
    .set('Content-Type', 'text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=0, must-revalidate')
    .send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: ${ADMIN_PATH}\nDisallow: ${ADMIN_PATH}/\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (_, res) => {
  const products = readProducts().map(normalizeProduct);
  const urls = [
    { loc: `${SITE_URL}/` },
    { loc: `${SITE_URL}/yhors-corp` },
    { loc: `${SITE_URL}/categoria/principal` },
    ...VALID_PUBLIC_CATEGORIES.map(category => ({ loc: `${SITE_URL}/categoria/${category}` })),
    ...products.map(product => ({ loc: productUrl(product), lastmod: product.updatedAt || product.createdAt }))
  ];

  const body = urls.map(({ loc, lastmod }) => {
    let safeLastmod = '';
    if (lastmod) {
      const date = new Date(lastmod);
      if (!Number.isNaN(date.getTime())) {
        safeLastmod = `<lastmod>${date.toISOString()}</lastmod>`;
      }
    }
    return `  <url><loc>${esc(loc)}</loc>${safeLastmod}</url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  res.status(200)
    .set('Content-Type', 'application/xml; charset=utf-8')
    .set('Cache-Control', 'public, max-age=0, must-revalidate')
    .send(xml);
});

// SEO-friendly public routes are rendered server-side so search engines receive useful HTML on first response.
app.get('/producto/:slug', (req, res) => {
  const products = readProducts().map(normalizeProduct);
  const product = findProductBySlug(products, req.params.slug);
  if (!product) return res.status(404).send(layout({
    title: 'Producto no encontrado | YHORS-STORE',
    description: 'El producto solicitado no está disponible en YHORS-STORE.',
    canonical: `${SITE_URL}/producto/${encodeURIComponent(req.params.slug)}`,
    robots: 'noindex,follow',
    body: `<main class="section"><h1>Producto no encontrado</h1><p>Este producto ya no está disponible.</p><a class="button" href="/">Volver a YHORS-STORE</a></main>`
  }));
  const url = productUrl(product);
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  const description = seoDescription(product.description, `${product.name} disponible en YHORS-STORE.`);
  const price = Number(product.salePrice ?? product.price);
  const productJson = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name,
    image: images.map(absoluteImage), description: stripText(product.description), sku: product.sku || undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    category: CATEGORY_LABELS[product.category] || product.category,
    offers: Number.isFinite(price) ? { '@type': 'Offer', url, priceCurrency: 'USD', price: price.toFixed(2), seller: { '@type': 'Organization', name: CORPORATE_NAME, url: `${SITE_URL}/yhors-corp` } } : undefined
  };
  Object.keys(productJson).forEach(k => productJson[k] === undefined && delete productJson[k]);
  const breadcrumb = { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[
    { '@type':'ListItem', position:1, name:'YHORS-STORE', item:`${SITE_URL}/` },
    { '@type':'ListItem', position:2, name:CATEGORY_LABELS[product.category] || product.category, item:`${SITE_URL}/categoria/${product.category}` },
    { '@type':'ListItem', position:3, name:product.name, item:url }
  ]};
  return res.send(layout({ title: `${product.name} | YHORS-STORE`, description, canonical:url, image:images[0] ? absoluteImage(images[0]) : '', json:[productJson,breadcrumb], body:productSeoBody(product) }));
});

app.get('/categoria/:category', (req, res, next) => {
  const key = String(req.params.category || '').toLowerCase();
  if (key === 'principal') return next();
  if (!VALID_PUBLIC_CATEGORIES.includes(key)) return next();
  const products = readProducts().map(normalizeProduct);
  const label = CATEGORY_LABELS[key];
  const canonical = `${SITE_URL}/categoria/${key}`;
  const description = CATEGORY_DESCRIPTIONS[key];
  const itemList = products.filter(p=>p.category===key).slice(0,100).map((p,i)=>({ '@type':'ListItem', position:i+1, name:p.name, url:productUrl(p) }));
  const breadcrumb = { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[
    { '@type':'ListItem', position:1, name:'YHORS-STORE', item:`${SITE_URL}/` },
    { '@type':'ListItem', position:2, name:label, item:canonical }
  ]};
  const listJson = { '@context':'https://schema.org', '@type':'ItemList', name:`Productos ${label} | YHORS-STORE`, itemListElement:itemList };
  return res.send(layout({ title:`${label} | YHORS-STORE`, description, canonical, json:[breadcrumb,listJson], body:categorySeoBody(key,products) }));
});

app.get('/categoria/todo', (_, res) => res.redirect(301, '/categoria/principal'));

app.get('/categoria/principal', (_, res) => {
  const products = readProducts().map(normalizeProduct);
  const canonical = `${SITE_URL}/categoria/principal`;
  const itemList = products.slice(0,100).map((p,i)=>({ '@type':'ListItem', position:i+1, name:p.name, url:productUrl(p) }));
  return res.send(layout({ title:'Catálogo | YHORS-STORE', description:CATEGORY_DESCRIPTIONS.principal, canonical, json:[
    { '@context':'https://schema.org', '@type':'ItemList', name:'Catálogo YHORS-STORE', itemListElement:itemList },
    { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[{ '@type':'ListItem', position:1, name:'YHORS-STORE', item:`${SITE_URL}/` },{ '@type':'ListItem', position:2, name:'Catálogo', item:canonical }] }
  ], body:categorySeoBody('principal',products) }));
});

app.get('/yhors-corp', (_, res) => {
  const canonical = `${SITE_URL}/yhors-corp`;
  return res.send(layout({ title:'YHORS-CORP | YHORS', description:'YHORS-CORP: espacio corporativo de YHORS y referencia de su ecosistema digital.', canonical, json:[
    { '@context':'https://schema.org', '@type':'Organization', name:CORPORATE_NAME, url:canonical, brand:{ '@type':'Brand', name:'YHORS' }, sameAs:[SITE_URL] },
    { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[{ '@type':'ListItem', position:1, name:'YHORS-STORE', item:`${SITE_URL}/` },{ '@type':'ListItem', position:2, name:'YHORS-CORP', item:canonical }] }
  ], body:corpSeoBody() }));
});

app.get('/', (req, res, next) => {
  // Redirect legacy product query URLs to their permanent, descriptive URL.
  if (req.query.producto) {
    const product = readProducts().map(normalizeProduct).find(item => item.id === String(req.query.producto));
    if (product) return res.redirect(301, productUrl(product));
  }
  // Search result pages are useful to users but should not become an indexable URL for every query.
  if (req.query.buscar) {
    const query = stripText(req.query.buscar).slice(0, 80);
    const products = readProducts().map(normalizeProduct);
    return res.send(layout({ title: `Resultados para ${query} | YHORS-STORE`, description: `Resultados de búsqueda de ${query} en YHORS-STORE.`, canonical: `${SITE_URL}/`, robots: 'noindex,follow', json: [], body: `<main class="section"><div class="section-heading"><div><span class="eyebrow">Búsqueda YHORS</span><h1>Resultados para “${esc(query)}”</h1></div><p>Usa el buscador para explorar productos, marcas y categorías de YHORS-STORE.</p></div><p><a class="button" href="/">Volver al catálogo <span>→</span></a></p></main>` }));
  }
  const products = readProducts().map(normalizeProduct);
  const canonical = `${SITE_URL}/`;
  const organization = { '@context':'https://schema.org', '@type':'Organization', name:CORPORATE_NAME, url:`${SITE_URL}/yhors-corp`, brand:{ '@type':'Brand', name:'YHORS' }, subOrganization:{ '@type':'OnlineStore', name:SITE_NAME, url:canonical } };
  const website = { '@context':'https://schema.org', '@type':'WebSite', name:SITE_NAME, alternateName:['YHORS','YHORS-STORE'], url:canonical, potentialAction:{ '@type':'SearchAction', target:`${SITE_URL}/?buscar={search_term_string}`, 'query-input':'required name=search_term_string' } };
  return res.send(layout({ title:'YHORS-STORE | Tecnología, detalles, cosplay y más', description:'YHORS-STORE | Tecnología, moda, regalos, cosplays y experiencias. Una selección de calidad, diseñada para quienes buscan confianza, estilo y más.', canonical, json:[organization,website], body:homeSeoBody(products) }));
});

app.use(ADMIN_PATH, (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', immutable: true }));

// Los archivos de la interfaz (HTML/CSS/JS) no deben quedarse congelados en la
// caché del navegador durante un despliegue. Esto permite que cada actualización
// del sitio se refleje automáticamente sin que el usuario tenga que borrar
// cookies o caché manualmente.
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const fileName = path.basename(filePath).toLowerCase();

    // HTML siempre debe comprobar si existe una versión nueva.
    if (fileName.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }

    // CSS y JS se revalidan automáticamente en cada visita.
    // Si no cambiaron, el servidor puede responder 304; si cambiaron,
    // el navegador descarga la versión nueva.
    if (fileName.endsWith('.css') || fileName.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }

    // Recursos estáticos pequeños (favicon, robots, etc.) también se
    // revalidan para que las modificaciones se reflejen sin borrar caché.
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}));

const storage = multer.diskStorage({
  destination: (_, __, done) => done(null, UPLOADS_DIR),
  filename: (_, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    done(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, done) => done(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype))
});

const backupUploadStorage = multer.diskStorage({
  destination: (_, __, done) => done(null, os.tmpdir()),
  filename: (_, file, done) => done(null, `yhors-backup-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.tar.gz`)
});
const backupUpload = multer({
  storage: backupUploadStorage,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_, file, done) => {
    const name = String(file.originalname || '').toLowerCase();
    if (/\.(tar\.gz|tgz)$/.test(name)) return done(null, true);
    return done(new Error('Solo se aceptan respaldos .tar.gz o .tgz descargados desde YHORS.'));
  }
});


function backupTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function copyDirectoryContents(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyDirectoryContents(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

function createBackup(reason = 'manual', options = {}) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const dirName = `YHORS-${backupTimestamp()}-${crypto.randomBytes(3).toString('hex')}`;
  const backupDir = path.join(BACKUPS_DIR, dirName);
  const backupDataDir = path.join(backupDir, 'data');
  const backupUploadsDir = path.join(backupDir, 'uploads');
  fs.mkdirSync(backupDataDir, { recursive: true });
  fs.mkdirSync(backupUploadsDir, { recursive: true });

  for (const fileName of ['products.json', 'storefront.json', 'classifications.json', 'orders.json', 'users.json', 'security.json']) {
    const source = path.join(DATA_DIR, fileName);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backupDataDir, fileName));
  }
  copyDirectoryContents(UPLOADS_DIR, backupUploadsDir);

  const manifest = {
    app: 'YHORS-STORE',
    backupVersion: 2,
    createdAt: new Date().toISOString(),
    reason,
    storageMode: process.env.YHORS_STORAGE_DIR ? 'persistent-configured' : 'local-filesystem',
    encryption: { algorithm: 'AES-256-GCM', keyFingerprint: YHORS_DATA_KEY_FINGERPRINT },
    files: {
      products: fs.existsSync(path.join(backupDataDir, 'products.json')) ? fs.statSync(path.join(backupDataDir, 'products.json')).size : 0,
      orders: fs.existsSync(path.join(backupDataDir, 'orders.json')) ? fs.statSync(path.join(backupDataDir, 'orders.json')).size : 0
    }
  };
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  pruneBackups(options.preserveNames || []);
  return { name: dirName, createdAt: manifest.createdAt, reason };
}

function listBackups() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const backups = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^YHORS-\d{8}-\d{6}Z-[a-f0-9]{6}$/.test(entry.name))
    .map(entry => {
      const dir = path.join(BACKUPS_DIR, entry.name);
      const manifestPath = path.join(dir, 'manifest.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return { name: entry.name, createdAt: manifest.createdAt || fs.statSync(dir).mtime.toISOString(), reason: manifest.reason || 'manual' };
      } catch {
        return { name: entry.name, createdAt: fs.statSync(dir).mtime.toISOString(), reason: 'unknown' };
      }
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Se muestran del más reciente al más antiguo, pero el número representa
  // la antigüedad: #1 es el más antiguo y el último número es el más reciente.
  return backups.map((backup, index, all) => ({
    ...backup,
    position: all.length - index,
    total: all.length,
    retention: BACKUP_RETENTION
  }));
}

function pruneBackups(preserveNames = []) {
  const preserved = new Set(preserveNames);
  const backups = listBackups().filter(backup => !preserved.has(backup.name));
  const keepSlots = Math.max(0, BACKUP_RETENTION - preserved.size);
  for (const backup of backups.slice(keepSlots)) {
    fs.rmSync(path.join(BACKUPS_DIR, backup.name), { recursive: true, force: true });
  }
}

function isValidBackupName(name) {
  return /^YHORS-\d{8}-\d{6}Z-[a-f0-9]{6}$/.test(String(name || ''));
}

function validateBackupDirectory(backupDir) {
  const requiredFiles = ['products.json', 'storefront.json', 'classifications.json', 'orders.json'];
  const dataDir = path.join(backupDir, 'data');
  if (!fs.existsSync(dataDir)) throw new Error('El respaldo no contiene la carpeta de datos.');

  for (const fileName of requiredFiles) {
    const file = path.join(dataDir, fileName);
    if (!fs.existsSync(file)) throw new Error(`Falta ${fileName} en el respaldo.`);
    JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  for (const fileName of ['users.json', 'security.json']) {
    const file = path.join(dataDir, fileName);
    if (fs.existsSync(file)) JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}

function replaceDirectoryContents(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    fs.rmSync(path.join(targetDir, entry.name), { recursive: true, force: true });
  }
  copyDirectoryContents(sourceDir, targetDir);
}

function readBackupManifest(backupDir) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('El manifest.json del respaldo no es válido.');
  }
}

function prepareOrdersForCurrentKey(sourceOrdersFile) {
  const parsed = JSON.parse(fs.readFileSync(sourceOrdersFile, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('El archivo de pedidos del respaldo no contiene una lista válida.');

  // Los respaldos V10 ya cifrados deben poder descifrarse con la clave actual.
  // Los respaldos anteriores a V10 se pueden migrar automáticamente al cifrado actual.
  let readableOrders;
  try {
    readableOrders = parsed.map(decryptOrder);
  } catch (error) {
    throw new Error('Este respaldo contiene pedidos cifrados con otra YHORS_DATA_KEY. No se restauró para evitar dejar el sistema sin acceso a los pedidos actuales.');
  }

  const temporaryFile = path.join(os.tmpdir(), `yhors-orders-restore-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.json`);
  fs.writeFileSync(temporaryFile, `${JSON.stringify(readableOrders.map(encryptOrder), null, 2)}\n`, 'utf8');
  return temporaryFile;
}

function applyBackupDirectory(backupDir) {
  validateBackupDirectory(backupDir);
  const manifest = readBackupManifest(backupDir);
  const manifestFingerprint = manifest?.encryption?.keyFingerprint;
  if (manifestFingerprint && manifestFingerprint !== YHORS_DATA_KEY_FINGERPRINT) {
    throw new Error('Este respaldo fue creado con otra YHORS_DATA_KEY. Usa la misma clave con la que fue generado o importa un respaldo compatible.');
  }

  const backupDataDir = path.join(backupDir, 'data');
  const requiredFiles = ['products.json', 'storefront.json', 'classifications.json', 'orders.json'];
  const preparedOrders = prepareOrdersForCurrentKey(path.join(backupDataDir, 'orders.json'));

  try {
    for (const fileName of requiredFiles) {
      const source = fileName === 'orders.json' ? preparedOrders : path.join(backupDataDir, fileName);
      const target = path.join(DATA_DIR, fileName);
      const temporaryFile = `${target}.restore.tmp`;
      fs.copyFileSync(source, temporaryFile);
      fs.renameSync(temporaryFile, target);
    }
    for (const fileName of ['users.json', 'security.json']) {
      const source = path.join(backupDataDir, fileName);
      if (!fs.existsSync(source)) continue;
      const target = path.join(DATA_DIR, fileName);
      const temporaryFile = `${target}.restore.tmp`;
      JSON.parse(fs.readFileSync(source, 'utf8'));
      fs.copyFileSync(source, temporaryFile);
      fs.renameSync(temporaryFile, target);
    }

    const backupUploadsDir = path.join(backupDir, 'uploads');
    if (fs.existsSync(backupUploadsDir)) replaceDirectoryContents(backupUploadsDir, UPLOADS_DIR);
  } finally {
    fs.rmSync(preparedOrders, { force: true });
  }
}

function restoreBackup(name) {
  if (!isValidBackupName(name)) throw new Error('Respaldo no válido.');
  const backupDir = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(backupDir)) throw new Error('Respaldo no encontrado.');

  // Primero se crea una copia de seguridad del estado actual.
  const safetyBackup = createBackup('antes-de-restaurar', { preserveNames: [name] });
  try {
    applyBackupDirectory(backupDir);
    pruneBackups([name, safetyBackup.name]);
    return { restored: name, safetyBackup };
  } catch (error) {
    // Si algo falla, intentamos volver al estado que había justo antes.
    try {
      applyBackupDirectory(path.join(BACKUPS_DIR, safetyBackup.name));
    } catch (rollbackError) {
      console.error('[YHORS] Falló también la recuperación del respaldo de seguridad:', rollbackError);
    }
    throw error;
  }
}

function isSafeArchiveEntry(entryName) {
  const normalized = String(entryName || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  const parts = normalized.split('/').filter(Boolean);
  return !parts.includes('..');
}

function locateExtractedBackup(rootDir) {
  const candidates = [rootDir];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(path.join(rootDir, entry.name));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'manifest.json')) && fs.existsSync(path.join(candidate, 'data', 'orders.json'))) return candidate;
  }
  throw new Error('No encontré un respaldo YHORS válido dentro del archivo. Usa el archivo .tar.gz descargado desde YHORS.');
}

function importBackupArchive(archivePath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yhors-backup-upload-'));
  try {
    let listing;
    try {
      listing = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    } catch {
      throw new Error('El archivo no es un respaldo .tar.gz válido de YHORS.');
    }
    const entries = listing.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    if (!entries.length || entries.some(entry => !isSafeArchiveEntry(entry))) {
      throw new Error('El respaldo contiene rutas no válidas y fue rechazado por seguridad.');
    }
    execFileSync('tar', ['-xzf', archivePath, '-C', tempRoot, '--no-same-owner', '--no-same-permissions'], { stdio: 'ignore', timeout: 120000 });
    const backupDir = locateExtractedBackup(tempRoot);
    validateBackupDirectory(backupDir);
    const manifest = readBackupManifest(backupDir);
    if (manifest?.encryption?.keyFingerprint && manifest.encryption.keyFingerprint !== YHORS_DATA_KEY_FINGERPRINT) {
      throw new Error('El respaldo fue creado con otra YHORS_DATA_KEY. No se restauró para proteger los pedidos actuales.');
    }

    // Validación previa: descifra y vuelve a cifrar en una ubicación temporal.
    const preparedOrders = prepareOrdersForCurrentKey(path.join(backupDir, 'data', 'orders.json'));
    fs.rmSync(preparedOrders, { force: true });

    // Se importa al almacenamiento persistente con el nombre original, para que
    // quede visible en la lista de backups y pueda descargarse nuevamente.
    const originalName = path.basename(backupDir);
    if (!isValidBackupName(originalName)) {
      throw new Error('El nombre del respaldo no tiene el formato esperado de YHORS.');
    }
    const destination = path.join(BACKUPS_DIR, originalName);
    if (fs.existsSync(destination)) {
      throw new Error('Ese respaldo ya existe en YHORS. Cambia el archivo o elimina la copia anterior.');
    }
    fs.cpSync(backupDir, destination, { recursive: true });
    pruneBackups([originalName]);

    const safetyBackup = createBackup('antes-de-restaurar', { preserveNames: [originalName] });
    try {
      applyBackupDirectory(destination);
      pruneBackups([originalName, safetyBackup.name]);
    } catch (error) {
      try { applyBackupDirectory(path.join(BACKUPS_DIR, safetyBackup.name)); } catch (rollbackError) {
        console.error('[YHORS] Falló también la recuperación del respaldo de seguridad importado:', rollbackError);
      }
      throw error;
    }
    return { restored: originalName, safetyBackup };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(archivePath, { force: true });
  }
}

function maybeAutoBackup() {
  try {
    const latest = listBackups()[0];
    if (!latest || (Date.now() - new Date(latest.createdAt).getTime()) >= AUTO_BACKUP_INTERVAL_MS) {
      return createBackup('automatico');
    }
  } catch (error) {
    console.error('[YHORS] No se pudo crear el respaldo automático:', error.message);
  }
  return null;
}

function readProducts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStorefront() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STOREFRONT_FILE, 'utf8'));
    return {
      heroProductIds: Array.isArray(parsed.heroProductIds) ? parsed.heroProductIds.filter(Boolean).slice(0, 8) : [],
      featuredProductIds: Array.isArray(parsed.featuredProductIds) ? parsed.featuredProductIds.filter(Boolean).slice(0, 12) : []
    };
  } catch {
    return { heroProductIds: [], featuredProductIds: [] };
  }
}

function writeStorefront(settings) {
  maybeAutoBackup();
  const temporaryFile = `${STOREFRONT_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, STOREFRONT_FILE);
}

function readClassifications() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CLASSIFICATIONS_FILE, 'utf8'));
    return { brands: parsed.brands || {}, productTypes: parsed.productTypes || {} };
  } catch { return { brands: {}, productTypes: {} }; }
}
function writeClassifications(settings) {
  maybeAutoBackup();
  const clean = { brands: {}, productTypes: {} };
  for (const key of ['brands','productTypes']) {
    for (const [category, values] of Object.entries(settings?.[key] || {})) {
      if (!['elegant','sports','tech','cosplay','pets','details','collectibles'].includes(category)) continue;
      clean[key][category] = [...new Set((Array.isArray(values) ? values : []).map(v => cleanText(v, 50)).filter(Boolean))].slice(0, 100);
    }
  }
  const temporaryFile = `${CLASSIFICATIONS_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, CLASSIFICATIONS_FILE);
  return clean;
}

function writeProducts(products) {
  maybeAutoBackup();
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(products, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, DATA_FILE);
}

function readOrders() {
  const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('El archivo de pedidos no contiene una lista válida.');
  return parsed.map(decryptOrder);
}

function writeOrders(orders) {
  maybeAutoBackup();
  const temporaryFile = `${ORDERS_FILE}.tmp`;
  const protectedOrders = orders.map(encryptOrder);
  fs.writeFileSync(temporaryFile, `${JSON.stringify(protectedOrders, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, ORDERS_FILE);
}

function nextOrderNumber(orders) {
  const max = orders.reduce((highest, order) => {
    const match = String(order.orderNumber || '').match(/YH-(\d+)/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `YH-${String(max + 1).padStart(4, '0')}`;
}

function validateOrder(input) {
  const customer = input?.customer || {};
  const name = cleanText(customer.name, 100);
  const phone = cleanText(customer.phone, 40);
  const cedula = cleanText(customer.cedula, 13).replace(/\D/g, '');
  const email = cleanText(customer.email, 120);
  const city = cleanText(customer.city, 80);
  const address = cleanText(customer.address, 240);
  const mapsUrl = cleanText(customer.mapsUrl, 500);
  const notes = cleanText(customer.notes, 500);
  const deliveryMethod = cleanText(input?.deliveryMethod, 30);
  const shippingCosts = { office: 0, local: 3, courier: 5 };
  const deliveryLabels = {
    office: 'Retiro en oficina',
    local: 'Envío YHORS',
    courier: 'Courier'
  };
  if (!shippingCosts.hasOwnProperty(deliveryMethod)) return { error: 'Selecciona una modalidad de entrega válida.' };
  if (!name || !phone || !cedula || !city) return { error: 'Completa nombre, teléfono, cédula/RUC y ciudad.' };
  if (!/^\d{10,13}$/.test(cedula)) return { error: 'La cédula/RUC debe tener entre 10 y 13 dígitos.' };
  if (deliveryMethod !== 'office' && !address) return { error: 'Ingresa la dirección para el envío seleccionado.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'El correo electrónico no es válido.' };
  if (mapsUrl && !/^https?:\/\//i.test(mapsUrl)) return { error: 'El enlace de Google Maps no es válido.' };

  const requestedItems = Array.isArray(input?.items) ? input.items : [];
  if (requestedItems.length < 1 || requestedItems.length > 50) return { error: 'El pedido no contiene productos válidos.' };

  const products = readProducts().map(normalizeProduct);
  const byId = new Map(products.map(product => [product.id, product]));
  const items = [];
  for (const requested of requestedItems) {
    const product = byId.get(String(requested.productId || ''));
    const quantity = Math.max(1, Math.min(99, Number.parseInt(requested.quantity, 10) || 0));
    if (!product || !quantity) return { error: 'Uno de los productos del carrito ya no está disponible.' };
    const purchaseMode = requested.purchaseMode === 'rental' ? 'rental' : 'purchase';
    const price = purchaseMode === 'rental' ? Number(product.rentalPrice) : Number(product.salePrice ?? product.price);
    if (!Number.isFinite(price) || price < 0 || (purchaseMode === 'rental' && product.rentalPrice === null)) {
      return { error: `El producto “${product.name}” no tiene un precio válido.` };
    }
    items.push({
      productId: product.id,
      sku: product.sku || '',
      name: product.name,
      category: product.category,
      purchaseMode,
      quantity,
      unitPrice: Math.round(price * 100) / 100,
      subtotal: Math.round(price * quantity * 100) / 100
    });
  }
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100;
  const shippingCost = shippingCosts[deliveryMethod];
  const total = Math.round((subtotal + shippingCost) * 100) / 100;
  return {
    order: {
      customer: { name, phone, cedula, email, city, address: deliveryMethod === 'office' ? '' : address, mapsUrl, notes },
      delivery: { method: deliveryMethod, label: deliveryLabels[deliveryMethod], cost: shippingCost },
      items, subtotal, shippingCost, total
    }
  };
}

function makeSession(user, role, accountId = '') {
  sessionCleanup();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = {
    id: token,
    user,
    role,
    accountId: String(accountId || ''),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_MS
  };
  sessions.set(token, session);
  return session;
}

function getSession(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.lastSeenAt = Date.now();
  return session;
}

function destroySession(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
}

function destroySessionsForAccount(accountId) {
  const target = String(accountId || '');
  if (!target) return;
  for (const [token, session] of sessions) {
    if (String(session.accountId || '') === target) sessions.delete(token);
  }
}

function sessionCleanup() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}
setInterval(sessionCleanup, 10 * 60 * 1000).unref();

function hasValidSession(req) { return Boolean(getSession(req)); }

function requireLogin(req, res, next) { const session = getSession(req); if (!session) return res.status(401).json({ error: 'No autorizado.' }); req.yhorsSession = session; next(); }

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Esta cuenta solo tiene acceso a Gestión de pedidos.' });
  return next();
}

function requireOrdersAccess(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });
  return next();
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}


function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

async function sendOrderConfirmationEmail(order) {
  const email = order?.customer?.email;
  if (!email) return { sent: false, reason: 'no-customer-email' };

  const itemsHtml = (order.items || []).map(item =>
    `<tr><td style="padding:8px 0">${escapeEmailHtml(item.quantity)}× ${escapeEmailHtml(item.name)}<br><small>SKU: ${escapeEmailHtml(item.sku || '—')}</small></td><td style="padding:8px 0;text-align:right">$${Number(item.subtotal || 0).toFixed(2)}</td></tr>`
  ).join('');
  const mapsHtml = order.customer.mapsUrl ? `<p><strong>Ubicación:</strong> <a href="${escapeEmailHtml(order.customer.mapsUrl)}">Abrir en Google Maps</a></p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#222">
    <h1 style="margin-bottom:4px">YHORS STORE</h1>
    <p>Hola ${escapeEmailHtml(order.customer.name)}, recibimos correctamente tu pedido.</p>
    <div style="padding:16px;border:1px solid #ddd;border-radius:10px">
      <h2 style="margin-top:0">Pedido #${escapeEmailHtml(order.orderNumber)}</h2>
      <p><strong>Estado:</strong> ${escapeEmailHtml(order.status)}</p>
      <p><strong>Entrega:</strong> ${escapeEmailHtml(order.delivery.label)} · $${Number(order.shippingCost || 0).toFixed(2)}</p>
      <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
      <hr style="border:0;border-top:1px solid #ddd">
      <p><strong>Subtotal:</strong> $${Number(order.subtotal || 0).toFixed(2)}</p>
      <p><strong>Envío:</strong> $${Number(order.shippingCost || 0).toFixed(2)}</p>
      <p style="text-align:right;font-size:18px"><strong>Total: $${Number(order.total || 0).toFixed(2)}</strong></p>
    </div>
    <p><strong>Cédula / RUC:</strong> ${escapeEmailHtml(order.customer.cedula || '—')}</p>
    <p><strong>Ciudad:</strong> ${escapeEmailHtml(order.customer.city || '—')}</p>
    <p><strong>Dirección:</strong> ${escapeEmailHtml(order.customer.address || 'Retiro en oficina')}</p>
    ${mapsHtml}
    ${order.customer.notes ? `<p><strong>Nota:</strong> ${escapeEmailHtml(order.customer.notes)}</p>` : ''}
    <p style="color:#777">Te contactaremos para continuar con la coordinación de tu pedido.</p>
  </div>`;
  const text = `YHORS STORE · Pedido #${order.orderNumber}\n\nHola ${order.customer.name}, recibimos correctamente tu pedido.\n\nTotal: $${Number(order.total || 0).toFixed(2)}\nEntrega: ${order.delivery.label}\nCédula/RUC: ${order.customer.cedula || '—'}\nCiudad: ${order.customer.city || '—'}\nDirección: ${order.customer.address || 'Retiro en oficina'}${order.customer.mapsUrl ? `\nGoogle Maps: ${order.customer.mapsUrl}` : ''}`;

  // Opción recomendada sin dominio: Google Apps Script envía desde tu propia cuenta Gmail.
  const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const appsScriptToken = process.env.GOOGLE_APPS_SCRIPT_TOKEN;
  if (appsScriptUrl && appsScriptToken) {
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: appsScriptToken,
        to: email,
        bcc: process.env.GOOGLE_NOTIFY_TO || '',
        subject: `YHORS STORE · Pedido #${order.orderNumber} recibido`,
        html,
        text,
        name: process.env.GOOGLE_FROM_NAME || 'YHORS STORE'
      })
    });
    if (!response.ok) throw new Error(`Google Apps Script rechazó el correo (${response.status}).`);
    const result = await response.text().catch(() => '');
    if (result && /error|exception|failed/i.test(result)) throw new Error(`Google Apps Script reportó un error: ${result.slice(0, 300)}`);
    return { sent: true, provider: 'google-apps-script' };
  }

  // Compatibilidad temporal con Resend si todavía está configurado.
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { sent: false, reason: 'email-provider-not-configured' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [email], subject: `YHORS STORE · Pedido #${order.orderNumber} recibido`, html })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rechazó el correo (${response.status}): ${detail.slice(0, 300)}`);
  }
  return { sent: true, provider: 'resend' };
}
function normalizeSku(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 40);
}

function skuBaseForProduct(product = {}) {
  const categoryCodes = { elegant: 'ELE', sports: 'SPT', tech: 'TEC', cosplay: 'COS', pets: 'PET', details: 'DET', collectibles: 'COL' };
  const category = categoryCodes[String(product.category || '').toLowerCase()] || 'YHR';
  const source = String(product.name || 'PROD').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12) || 'PROD';
  return `YH-${category}-${source}`;
}

function makeUniqueSku(inputSku, product, products, currentId = '') {
  const requested = normalizeSku(inputSku);
  const base = requested || skuBaseForProduct(product);
  const used = new Set(products.filter(item => item.id !== currentId).map(item => normalizeSku(item.sku)).filter(Boolean));
  if (!used.has(base)) return base;
  for (let i = 2; i < 10000; i += 1) {
    const candidate = `${base.slice(0, 36)}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `YH-${Date.now()}`;
}

function validateProduct(input, current = {}, allProducts = []) {
  const name = cleanText(input.name, 90);
  const description = cleanText(input.description, 2000);
  const category = cleanText(input.category, 30).toLowerCase();
  const brand = cleanText(input.brand, 50);
  const productType = cleanText(input.productType, 50);
  const requestedSku = normalizeSku(input.sku);
  const salePrice = Number(input.salePrice ?? input.price);
  const rentalRaw = input.rentalPrice;
  const rentalPrice = rentalRaw === '' || rentalRaw === null || rentalRaw === undefined ? null : Number(rentalRaw);
  const image = cleanText(input.image, 1000);
  const validCategories = ['elegant', 'sports', 'tech', 'cosplay', 'pets', 'details', 'collectibles'];
  const sku = makeUniqueSku(requestedSku, { name, category }, allProducts, current.id || '');
  if (!name || !description || !validCategories.includes(category) || !Number.isFinite(salePrice) || salePrice < 0 || salePrice > 100000000) {
    return { error: 'Revisa nombre, descripción, categoría y precio de venta.' };
  }
  if (category === 'cosplay' && (rentalPrice === null || !Number.isFinite(rentalPrice) || rentalPrice < 0 || rentalPrice > 100000000)) {
    return { error: 'En Cosplay debes indicar un precio de alquiler válido.' };
  }
  const rawImages = Array.isArray(input.images) ? input.images : [image];
  const images = rawImages.map(value => cleanText(value, 1000)).filter(Boolean).slice(0, 4);
  if (image && !(/^\/uploads\/[a-zA-Z0-9._-]+$/.test(image) || /^https:\/\/[a-zA-Z0-9./?&=_:%#-]+$/.test(image))) return { error: 'La URL de la imagen principal no es válida.' };
  for (const imageUrl of images) {
    if (!(/^\/uploads\/[a-zA-Z0-9._-]+$/.test(imageUrl) || /^https:\/\/[a-zA-Z0-9./?&=_:%#-]+$/.test(imageUrl))) return { error: 'Una de las URL de las imágenes no es válida.' };
  }
  const finalImages = images.length ? images : (current.images?.length ? current.images : (current.image ? [current.image] : []));
  return { product: {
    ...current, name, description, category, brand, productType, sku,
    salePrice: Math.round(salePrice * 100) / 100,
    rentalPrice: category === 'cosplay' ? Math.round(rentalPrice * 100) / 100 : null,
    price: Math.round(salePrice * 100) / 100,
    image: finalImages[0] || '', images: finalImages,
    featured: input.featured === true || input.featured === 'true',
    hero: input.hero === true || input.hero === 'true',
    heroOrder: Number.isFinite(Number(input.heroOrder)) ? Math.max(0, Math.min(999, Number(input.heroOrder))) : (Number(current.heroOrder) || 0)
  }};
}
function deleteUploadedImage(image) {
  if (!image || !image.startsWith('/uploads/')) return;
  const fileName = path.basename(image);
  const target = path.join(UPLOADS_DIR, fileName);
  if (target.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(target)) fs.unlinkSync(target);
}

function normalizeProduct(product) {
  const images = Array.isArray(product.images) && product.images.length
    ? product.images.filter(Boolean)
    : (product.image ? [product.image] : []);
  return { ...product, sku: normalizeSku(product.sku) || makeUniqueSku('', product, [], product.id), image: product.image || images[0] || '', images };
}

app.get('/api/products', (_, res) => res.json(readProducts().map(normalizeProduct)));
app.get('/api/classifications', (_, res) => res.json(readClassifications()));
app.get('/api/storefront', (_, res) => {
  const settings = readStorefront();
  return res.json({ ...settings, whatsappNumber: String(process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '') });
});
app.get('/api/health', (_, res) => res.json({ ok: true }));

function setSessionCookie(res, session) {
  res.cookie(SESSION_COOKIE, session.id, { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: SESSION_TTL_MS, path: '/' });
}

function createWebAuthnChallenge(kind, accountId = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  pendingWebAuthn.set(token, { kind, accountId: accountId ? String(accountId) : '', expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

function consumeWebAuthnChallenge(token, kind) {
  const item = pendingWebAuthn.get(token);
  pendingWebAuthn.delete(token);
  if (!item || item.kind !== kind || item.expiresAt <= Date.now()) return null;
  return item;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, item] of pendingWebAuthn) if (item.expiresAt <= now) pendingWebAuthn.delete(token);
}, 60 * 1000).unref();

app.get('/api/passkey/options', async (req, res) => {
  const username = normalizeUsername(req.query?.username || '');
  const account = username ? findUserByUsername(username) : null;
  if (account && !passkeyAllowed(account.id)) return res.status(403).json({ error: 'El inicio con Passkey está desactivado para esta cuenta.' });
  const credentials = account ? accountPasskeys(account.id) : [];
  const options = await generateAuthenticationOptions({
    rpID: WEBAUTHN_RP_ID,
    userVerification: 'preferred',
    allowCredentials: credentials.map(item => ({ id: item.id, transports: item.transports || [] }))
  });
  const token = createWebAuthnChallenge('login', account?.id || '');
  res.cookie('yhors_webauthn_challenge', token, { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: 5 * 60 * 1000, path: '/' });
  pendingWebAuthn.get(token).options = options;
  return res.json(options);
});

app.post('/api/passkey/login', async (req, res) => {
  const token = req.cookies.yhors_webauthn_challenge;
  const challenge = consumeWebAuthnChallenge(token, 'login');
  res.clearCookie('yhors_webauthn_challenge', { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });
  if (!challenge?.options) return res.status(401).json({ error: 'El desafío Passkey expiró. Inténtalo nuevamente.' });
  const passkeyId = String(req.body?.id || '');
  const users = readUsers();
  let account = challenge.accountId ? users.find(u => u.id === challenge.accountId) : null;
  let credential = null;
  if (account) credential = accountPasskeys(account.id).find(item => item.id === passkeyId);
  if (!credential && !account) {
    for (const user of users) {
      const found = accountPasskeys(user.id).find(item => item.id === passkeyId);
      if (found) { account = user; credential = found; break; }
    }
  }
  if (!account || account.active === false || !credential || !passkeyAllowed(account.id)) return res.status(401).json({ error: 'Passkey no reconocida o no autorizada.' });
  try {
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challenge.options.challenge,
      expectedOrigin: WEBAUTHN_ORIGIN,
      expectedRPID: WEBAUTHN_RP_ID,
      requireUserVerification: true,
      credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')), counter: credential.counter || 0, transports: credential.transports || [] }
    });
    if (!verification.verified) return res.status(401).json({ error: 'No se pudo verificar la Passkey.' });
    const store = readPasskeyStore();
    const list = store.passkeys[String(account.id)] || [];
    const index = list.findIndex(item => item.id === credential.id);
    if (index >= 0) { list[index].counter = verification.authenticationInfo.newCounter; list[index].lastUsedAt = new Date().toISOString(); store.passkeys[String(account.id)] = list; writePasskeyStore(store); }
    clearFailedAttempts(clientIp(req), account.username);
    const session = makeSession(account.username, account.role, account.id);
    setSessionCookie(res, session);
    return res.json({ ok: true, role: session.role, username: account.username, name: account.name, expiresAt: session.expiresAt });
  } catch (error) { return res.status(401).json({ error: 'No se pudo verificar la Passkey.' }); }
});

app.get('/api/me', (req, res) => {
  const session = getSession(req); if (!session) return res.status(401).json({ error: 'No autorizado.' });
  const user = readUsers().find(item => item.id === session.accountId); if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  return res.json({ ...publicUser(user), passkeys: publicPasskeys(user.id) });
});

app.get('/api/me/passkeys/options', requireLogin, async (req, res) => {
  const session = getSession(req); const user = readUsers().find(item => item.id === session.accountId);
  if (!user || !passkeyAllowed(user.id)) return res.status(403).json({ error: 'El inicio con Passkey está desactivado para esta cuenta.' });
  const options = await generateRegistrationOptions({
    rpName: 'YHORS STORE', rpID: WEBAUTHN_RP_ID, userName: user.username, userID: new Uint8Array(Buffer.from(user.id)),
    attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: accountPasskeys(user.id).map(item => ({ id: item.id, transports: item.transports || [] })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required', authenticatorAttachment: 'platform' }
  });
  const token = createWebAuthnChallenge('registration', user.id); pendingWebAuthn.get(token).options = options;
  res.cookie('yhors_webauthn_challenge', token, { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: 5 * 60 * 1000, path: '/' });
  return res.json(options);
});

app.post('/api/me/passkeys', requireLogin, async (req, res) => {
  const session = getSession(req); const user = readUsers().find(item => item.id === session.accountId); const token = req.cookies.yhors_webauthn_challenge;
  const challenge = consumeWebAuthnChallenge(token, 'registration'); res.clearCookie('yhors_webauthn_challenge', { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });
  if (!user || !challenge?.options || challenge.accountId !== user.id) return res.status(400).json({ error: 'El desafío Passkey expiró.' });
  try {
    const verification = await verifyRegistrationResponse({ response: req.body, expectedChallenge: challenge.options.challenge, expectedOrigin: WEBAUTHN_ORIGIN, expectedRPID: WEBAUTHN_RP_ID, supportedAlgorithmIDs: [-7, -257] });
    if (!verification.verified) return res.status(400).json({ error: 'No se pudo verificar la Passkey.' });
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const store = readPasskeyStore(); const list = store.passkeys[user.id] || [];
    list.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports || [], deviceType: credentialDeviceType, backedUp: credentialBackedUp, name: String(req.body?.deviceName || 'Este dispositivo').slice(0, 80), createdAt: new Date().toISOString() });
    store.passkeys[user.id] = list; store.passkeyPolicy[user.id] = true; writePasskeyStore(store);
    return res.json({ ok: true, passkeys: publicPasskeys(user.id) });
  } catch (error) { return res.status(400).json({ error: error.message || 'No se pudo registrar la Passkey.' }); }
});

app.delete('/api/me/passkeys/:id', requireLogin, (req, res) => {
  const session = getSession(req); const store = readPasskeyStore(); const list = store.passkeys[session.accountId] || [];
  if (list.length <= 1) return res.status(400).json({ error: 'Debes conservar al menos una Passkey o contraseña para mantener acceso a la cuenta.' });
  store.passkeys[session.accountId] = list.filter(item => item.id !== req.params.id); writePasskeyStore(store); return res.json({ ok: true, passkeys: publicPasskeys(session.accountId) });
});

app.post('/api/admin/users/:id/passkeys/policy', requireAdmin, (req, res) => {
  const users = readUsers(); const user = users.find(item => item.id === req.params.id); if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const store = readPasskeyStore(); store.passkeyPolicy[user.id] = req.body?.enabled !== false; writePasskeyStore(store); return res.json(publicUser(user));
});

app.delete('/api/admin/users/:id/passkeys', requireAdmin, (req, res) => {
  const users = readUsers(); const user = users.find(item => item.id === req.params.id); if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const store = readPasskeyStore(); store.passkeys[user.id] = []; writePasskeyStore(store); destroySessionsForAccount(user.id); return res.json(publicUser(user));
});

app.post('/api/provider/reset-login-lock', (req, res) => {
  const configuredToken = String(process.env.PROVIDER_RESET_TOKEN || '').trim();
  const suppliedToken = String(req.get('x-provider-reset-token') || req.body?.providerToken || '').trim();
  if (!configuredToken || configuredToken.length < 32 || !suppliedToken || Buffer.byteLength(suppliedToken) !== Buffer.byteLength(configuredToken) || !crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(configuredToken))) {
    return res.status(403).json({ error: 'No autorizado.' });
  }
  const username = normalizeUsername(req.body?.username);
  const user = findUserByUsername(username);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  clearLoginProtection(user.id);
  return res.json({ ok: true, username: user.username });
});

app.post('/api/login', async (req, res) => {
  ensureUsers();
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const ip = clientIp(req);

  if (!username || !password) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

  const key = rateLimitKey(ip, username);
  const ipKey = `login-ip:${ip}`;
  const ipEntry = loginAttempts.get(ipKey);
  // El bloqueo progresivo por cuenta controla los 4 intentos + escalamiento.
  // El límite por IP sigue siendo una barrera adicional contra ataques distribuidos desde un mismo origen.
  if (isRateLimited(ipKey, LOGIN_IP_LIMIT_MAX_ATTEMPTS)) return rateLimitResponse(res, ipEntry.resetAt);

  const account = findUserByUsername(username);
  if (account) {
    const protection = loginProtectionStatus(account.id);
    if (protection.locked) {
      if (protection.permanent) return res.status(423).json({ error: 'Tu acceso está bloqueado. Indica a tu proveedor que restablezca la contraseña para recuperar el acceso.', permanentLock: true });
      return res.status(423).json({ error: `Acceso bloqueado temporalmente. Inténtalo nuevamente en ${Math.ceil(protection.remainingSeconds / 60)} minuto(s).`, lockoutSeconds: protection.remainingSeconds, lockoutStage: protection.stage });
    }
  }

  let passwordMatches = false;
  if (account?.passwordHash) {
    try { passwordMatches = await bcrypt.compare(password, account.passwordHash); } catch { passwordMatches = false; }
  }

  if (!account || !passwordMatches) {
    registerFailedAttempt(key);
    registerFailedAttempt(ipKey);
    if (account) {
      const protection = registerAccountPasswordFailure(account.id);
      if (protection.permanent) return res.status(423).json({ error: 'Tu acceso ha sido bloqueado definitivamente por seguridad. Indica a tu proveedor que restablezca la contraseña.', permanentLock: true });
      if (protection.locked) {
        const minutes = Math.ceil(protection.remainingSeconds / 60);
        return res.status(423).json({ error: `Demasiados intentos. Tu acceso se bloqueará durante ${minutes} minutos.`, lockoutSeconds: protection.remainingSeconds, lockoutStage: protection.stage });
      }
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.', attemptsRemaining: protection.attemptsRemaining, attemptsUsed: protection.failures, attemptsLimit: ACCOUNT_LOGIN_ATTEMPTS_BEFORE_LOCK });
    }
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  clearFailedAttempts(ip, username);
  clearLoginProtection(account.id);
  const session = makeSession(account.username, account.role, account.id);
  res.cookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
  return res.json({
    ok: true,
    role: session.role,
    username: account.username,
    name: account.name,
    expiresAt: session.expiresAt,
    requiresTwoFactor: false
  });
});

app.post('/api/login/2fa', (req, res) => {
  const challengeToken = req.cookies.yhors_2fa_challenge;
  const code = String(req.body?.code || '').replace(/\s/g, '');
  const ip = clientIp(req);
  if (!challengeToken || !/^\d{6}$/.test(code)) return res.status(401).json({ error: 'Código 2FA incorrecto.' });

  const challenge = pendingTwoFactor.get(challengeToken);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    pendingTwoFactor.delete(challengeToken);
    res.clearCookie('yhors_2fa_challenge', { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });
    return res.status(401).json({ error: 'El desafío 2FA expiró. Inicia sesión nuevamente.' });
  }

  const key = rateLimitKey(ip, challenge.user, '2fa');
  const entry = loginAttempts.get(key);
  if (isRateLimited(key, LOGIN_LIMIT_MAX_ATTEMPTS)) return rateLimitResponse(res, entry.resetAt);

  const record = twoFactorRecord(challenge.accountId);
  const secret = decryptTwoFactorSecret(record?.secret);
  if (!secret || !verifyTotp(secret, code)) {
    registerFailedAttempt(key);
    return res.status(401).json({ error: 'Código 2FA incorrecto.' });
  }

  clearFailedAttempts(ip, challenge.user);
  loginAttempts.delete(key);
  pendingTwoFactor.delete(challengeToken);
  res.clearCookie('yhors_2fa_challenge', { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });

  const session = makeSession(challenge.user, challenge.role, challenge.accountId);
  res.cookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
  return res.json({ ok: true, role: session.role, username: session.user, expiresAt: session.expiresAt });
});

app.post('/api/logout', (req, res) => {
  destroySession(req);
  res.clearCookie('yhors_2fa_challenge', { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });
  res.json({ ok: true });
});


app.post('/api/orders', async (req, res) => {
  const result = validateOrder(req.body || {});
  if (result.error) return res.status(400).json(result);
  const orders = readOrders();
  const order = {
    id: crypto.randomUUID(),
    orderNumber: nextOrderNumber(orders),
    status: 'Pendiente',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...result.order
  };
  orders.unshift(order);
  writeOrders(orders);
  try { await sendOrderConfirmationEmail(order); } catch (emailError) { console.error('[YHORS] No se pudo enviar la confirmación por correo:', emailError.message); }
  return res.status(201).json({ orderNumber: order.orderNumber, status: order.status, total: order.total });
});

app.get('/api/admin/session', (req, res) => { const session = getSession(req); return res.json({ authenticated: Boolean(session), username: session?.user || null, role: session?.role || null }); });
app.get('/api/admin/security', requireAdmin, (_, res) => res.json({
  dataEncryption: 'AES-256-GCM',
  ordersEncryptedAtRest: true,
  keySource: 'YHORS_DATA_KEY environment variable',
  version: 'V14.1',
  passkeys: 'WebAuthn / Passkeys',
  serverSideSessions: true,
  loginRateLimit: true
}));

app.get('/api/admin/users', requireAdmin, (_, res) => {
  ensureUsers();
  return res.json(readUsers().map(publicUser));
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  ensureUsers();
  const users = readUsers();
  const result = validateNewUser(req.body || {}, users);
  if (result.error) return res.status(400).json({ error: result.error });
  if (!result.user.password) return res.status(400).json({ error: 'La contraseña es obligatoria al crear un usuario.' });
  const user = {
    id: crypto.randomUUID(),
    name: result.user.name,
    username: result.user.username,
    passwordHash: await bcrypt.hash(result.user.password, 12),
    role: result.user.role,
    active: result.user.active,
    system: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  users.push(user);
  writeUsers(users);
  return res.status(201).json(publicUser(user));
});

app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  ensureUsers();
  const users = readUsers();
  const index = users.findIndex(user => user.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const current = users[index];
  const result = validateNewUser(req.body || {}, users, current.id);
  if (result.error) return res.status(400).json({ error: result.error });

  if (current.system && result.user.username !== current.username) {
    return res.status(400).json({ error: 'Las cuentas del sistema no pueden cambiar su nombre de usuario.' });
  }
  if (current.role === 'admin' && result.user.role !== 'admin' && users.filter(user => user.role === 'admin' && user.active !== false).length <= 1) {
    return res.status(400).json({ error: 'Debe existir al menos un administrador activo.' });
  }
  if (current.username === getSession(req)?.user && result.user.active === false) {
    return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta mientras estás conectado.' });
  }

  const updated = {
    ...current,
    name: result.user.name,
    username: result.user.username,
    role: result.user.role,
    active: result.user.active,
    updatedAt: new Date().toISOString()
  };
  if (result.user.password) updated.passwordHash = await bcrypt.hash(result.user.password, 12);
  users[index] = updated;
  writeUsers(users);
  if (current.role !== updated.role || current.active !== updated.active || Boolean(result.user.password)) {
    destroySessionsForAccount(current.id);
  }
  return res.json(publicUser(updated));
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  ensureUsers();
  const users = readUsers();
  const index = users.findIndex(user => user.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const target = users[index];
  const session = getSession(req);
  if (target.username === session?.user) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  if (target.role === 'admin' && target.active !== false && users.filter(user => user.role === 'admin' && user.active !== false).length <= 1) {
    return res.status(400).json({ error: 'Debe existir al menos un administrador activo.' });
  }
  users.splice(index, 1);
  writeUsers(users);
  disableTwoFactor(target.id);
  destroySessionsForAccount(target.id);
  return res.status(204).end();
});


app.post('/api/admin/users/:id/2fa/setup', requireAdmin, (req, res) => {
  ensureUsers();
  const user = readUsers().find(item => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const setup = createTwoFactorSetup(user.id, user.username);
  return res.json({ ok: true, secret: setup.secret, otpauthUri: setup.otpauthUri, issuer: TWO_FACTOR_ISSUER, period: TWO_FACTOR_STEP_SECONDS, digits: TWO_FACTOR_DIGITS });
});

app.post('/api/admin/users/:id/2fa/verify', requireAdmin, (req, res) => {
  ensureUsers();
  const user = readUsers().find(item => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const code = String(req.body?.code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Ingresa un código 2FA de 6 dígitos.' });
  if (!enableTwoFactor(user.id, user.username, code)) return res.status(400).json({ error: 'El código 2FA no es válido o expiró.' });
  return res.json({ ok: true, twoFactorEnabled: true });
});

app.delete('/api/admin/users/:id/2fa', requireAdmin, (req, res) => {
  ensureUsers();
  const user = readUsers().find(item => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (user.id === getSession(req)?.accountId) return res.status(400).json({ error: 'No puedes desactivar tu propio 2FA desde esta sesión.' });
  disableTwoFactor(user.id);
  return res.json({ ok: true, twoFactorEnabled: false });
});

app.get('/api/admin/orders', requireOrdersAccess, (_, res) => res.json(readOrders()));
app.put('/api/admin/orders/:id', requireOrdersAccess, (req, res) => {
  const allowed = ['Pendiente', 'Confirmado', 'Preparando', 'Enviado', 'Entregado', 'Cancelado'];
  const body = req.body || {};
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
  const hasInternalNote = Object.prototype.hasOwnProperty.call(body, 'internalNote');
  if (!hasStatus && !hasInternalNote) return res.status(400).json({ error: 'No hay cambios para guardar.' });

  let normalizedStatus;
  if (hasStatus) {
    const status = cleanText(body.status, 30);
    normalizedStatus = allowed.find(item => item.toLocaleLowerCase('es-EC') === status.toLocaleLowerCase('es-EC'));
    if (!normalizedStatus) return res.status(400).json({ error: 'Estado de pedido no válido.' });
  }

  const orders = readOrders();
  const index = orders.findIndex(order => order.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Pedido no encontrado.' });

  const updated = { ...orders[index], updatedAt: new Date().toISOString() };
  if (hasStatus) updated.status = normalizedStatus;
  if (hasInternalNote) updated.internalNote = cleanText(body.internalNote, 5000);
  orders[index] = updated;
  writeOrders(orders);
  return res.json(updated);
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orders = readOrders();
  const order = orders.find(item => item.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  writeOrders(orders.filter(item => item.id !== req.params.id));
  return res.status(204).end();
});


app.get('/api/admin/backups', requireAdmin, (_, res) => {
  return res.json({
    storageMode: process.env.YHORS_STORAGE_DIR ? 'persistent' : 'local',
    storageRoot: process.env.YHORS_STORAGE_DIR ? STORAGE_ROOT : 'local',
    retention: BACKUP_RETENTION,
    automaticEveryHours: AUTO_BACKUP_INTERVAL_MS / (60 * 60 * 1000),
    backups: listBackups()
  });
});

app.post('/api/admin/backups', requireAdmin, (_, res) => {
  try {
    const backup = createBackup('manual');
    return res.status(201).json({ ok: true, backup });
  } catch (error) {
    console.error('[YHORS] Error creando respaldo manual:', error);
    return res.status(500).json({ error: 'No se pudo crear el respaldo.' });
  }
});

app.post('/api/admin/backups/:name/restore', requireAdmin, (req, res) => {
  const name = String(req.params.name || '');
  if (!isValidBackupName(name)) return res.status(400).json({ error: 'Respaldo no válido.' });
  const backupDir = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(backupDir)) return res.status(404).json({ error: 'Respaldo no encontrado.' });
  try {
    const result = restoreBackup(name);
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[YHORS] Error restaurando respaldo:', error);
    return res.status(500).json({ error: error.message || 'No se pudo restaurar el respaldo.' });
  }
});

app.post('/api/admin/backups/upload', requireAdmin, backupUpload.single('backup'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo .tar.gz o .tgz de YHORS.' });
  try {
    const result = importBackupArchive(req.file.path);
    return res.json({ ok: true, ...result, message: 'Respaldo importado y restaurado correctamente.' });
  } catch (error) {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    console.error('[YHORS] Error importando respaldo:', error);
    return res.status(400).json({ error: error.message || 'No se pudo importar el respaldo.' });
  }
});

app.delete('/api/admin/backups/:name', requireAdmin, (req, res) => {
  const name = String(req.params.name || '');
  if (!isValidBackupName(name)) {
    return res.status(400).json({ error: 'Respaldo no válido.' });
  }
  const backupDir = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(backupDir)) return res.status(404).json({ error: 'Respaldo no encontrado.' });
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
    const archivePath = path.join(BACKUPS_DIR, `${name}.tar.gz`);
    fs.rmSync(archivePath, { force: true });
    return res.status(204).end();
  } catch (error) {
    console.error('[YHORS] Error eliminando respaldo:', error);
    return res.status(500).json({ error: 'No se pudo eliminar el respaldo.' });
  }
});

app.get('/api/admin/backups/:name/download', requireAdmin, (req, res) => {
  const name = String(req.params.name || '');
  if (!isValidBackupName(name)) return res.status(400).json({ error: 'Respaldo no válido.' });
  const backupDir = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(backupDir)) return res.status(404).json({ error: 'Respaldo no encontrado.' });

  const archivePath = path.join(BACKUPS_DIR, `${name}.tar.gz`);
  try {
    const { execFileSync } = require('child_process');
    execFileSync('tar', ['-czf', archivePath, '-C', BACKUPS_DIR, name], { stdio: 'ignore', timeout: 120000 });
    res.download(archivePath, `${name}.tar.gz`, error => {
      fs.rmSync(archivePath, { force: true });
      if (error && !res.headersSent) res.status(500).json({ error: 'No se pudo descargar el respaldo.' });
    });
  } catch (error) {
    fs.rmSync(archivePath, { force: true });
    console.error('[YHORS] Error exportando respaldo:', error);
    return res.status(500).json({ error: 'No se pudo preparar el respaldo para descarga.' });
  }
});

app.get('/api/admin/products', requireAdmin, (_, res) => res.json(readProducts().map(normalizeProduct)));
app.get('/api/admin/storefront', requireAdmin, (_, res) => res.json(readStorefront()));
app.get('/api/admin/classifications', requireAdmin, (_, res) => res.json(readClassifications()));
app.put('/api/admin/classifications', requireAdmin, (req, res) => res.json(writeClassifications(req.body || {})));

app.put('/api/admin/storefront', requireAdmin, (req, res) => {
  const products = readProducts();
  const ids = new Set(products.map(product => product.id));
  const heroProductIds = Array.isArray(req.body?.heroProductIds) ? req.body.heroProductIds.filter(id => ids.has(id)).slice(0, 8) : [];
  const featuredProductIds = Array.isArray(req.body?.featuredProductIds) ? req.body.featuredProductIds.filter(id => ids.has(id)).slice(0, 12) : [];
  const heroOrders = (req.body && req.body.heroOrders && typeof req.body.heroOrders === 'object') ? req.body.heroOrders : {};
  const settings = { heroProductIds, featuredProductIds };
  writeStorefront(settings);
  const heroSet = new Set(heroProductIds);
  const featuredSet = new Set(featuredProductIds);
  const updated = products.map(product => ({
    ...product,
    hero: heroSet.has(product.id),
    featured: featuredSet.has(product.id),
    heroOrder: heroSet.has(product.id)
      ? Math.max(1, Math.min(999, Number(heroOrders[product.id]) || (heroProductIds.indexOf(product.id) + 1)))
      : 0,
    updatedAt: new Date().toISOString()
  }));
  writeProducts(updated);
  return res.json(settings);
});

app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen JPG, PNG, WEBP o GIF de máximo 5 MB.' });
  return res.status(201).json({ image: `/uploads/${req.file.filename}` });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const products = readProducts();
  const result = validateProduct(req.body, {}, products);
  if (result.error) return res.status(400).json(result);
  const product = normalizeProduct({ ...result.product, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  products.unshift(product);
  writeProducts(products);
  return res.status(201).json(product);
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const index = products.findIndex((product) => product.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Producto no encontrado.' });
  const previous = products[index];
  const result = validateProduct(req.body, previous, products);
  if (result.error) return res.status(400).json(result);
  products[index] = normalizeProduct({ ...result.product, id: previous.id, createdAt: previous.createdAt, updatedAt: new Date().toISOString() });
  const previousImages = Array.isArray(previous.images) ? previous.images : (previous.image ? [previous.image] : []);
  const currentImages = new Set(products[index].images || []);
  previousImages.forEach(imageUrl => { if (!currentImages.has(imageUrl)) deleteUploadedImage(imageUrl); });
  writeProducts(products);
  return res.json(products[index]);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const product = products.find((item) => item.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });
  writeProducts(products.filter((item) => item.id !== req.params.id));
  (product.images || [product.image]).forEach(deleteUploadedImage);
  return res.status(204).end();
});

app.use((_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _, res, __) => {
  if (error instanceof multer.MulterError) {
    if (error.field === 'backup') return res.status(400).json({ error: 'El respaldo supera el límite de 250 MB.' });
    return res.status(400).json({ error: 'La imagen supera el límite de 5 MB.' });
  }
  if (error?.message?.includes('Solo se aceptan respaldos')) return res.status(400).json({ error: error.message });
  if (error?.message?.includes('No se pudo descifrar la información del pedido')) {
    return res.status(500).json({ error: 'No se pudo leer los pedidos porque YHORS_DATA_KEY no coincide con la clave con la que fueron cifrados. Verifica la clave de este entorno.' });
  }
  if (error) return res.status(400).json({ error: error.message || 'No se pudo procesar la solicitud.' });
});

app.listen(PORT, () => console.log(`YHORS disponible en http://localhost:${PORT}`));
