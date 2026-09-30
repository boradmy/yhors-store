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
const SALES_FILE = path.join(DATA_DIR, 'sales.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const PURCHASES_FILE = path.join(DATA_DIR, 'purchases.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');
const AUDIT_MAX_RECORDS = 50000;

function readAudit() {
  try {
    const parsed = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAudit(entries) {
  fs.writeFileSync(AUDIT_FILE, `${JSON.stringify(entries.slice(-AUDIT_MAX_RECORDS), null, 2)}\n`, 'utf8');
}

function auditValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string') return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(auditValue);
  if (typeof value === 'object') {
    const safe = {};
    for (const [key, val] of Object.entries(value)) {
      if (/password|token|secret|cookie|authorization|hash/i.test(key)) continue;
      safe[key] = auditValue(val);
    }
    return safe;
  }
  return String(value);
}

function auditDiff(before, after, fields) {
  const changes = {};
  for (const field of fields) {
    const a = auditValue(before?.[field]);
    const b = auditValue(after?.[field]);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = { before: a, after: b };
  }
  return changes;
}

function auditLog(req, action, module, details = {}, result = 'success') {
  try {
    const session = req ? getSession(req) : null;
    const entry = {
      id: `AUD-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      createdAt: new Date().toISOString(),
      username: session?.username || details.username || null,
      accountId: session?.accountId || details.accountId || null,
      role: session?.role || details.role || null,
      module,
      action,
      result,
      ip: req?.ip || req?.socket?.remoteAddress || null,
      userAgent: req?.get?.('user-agent')?.slice(0, 300) || null,
      details: auditValue(details)
    };
    const entries = readAudit();
    entries.push(entry);
    writeAudit(entries);
  } catch (error) {
    console.error('[YHORS AUDIT] No se pudo registrar evento:', error.message);
  }
}

function auditStockMovementDiff(beforeProducts = [], afterProducts = [], reason = 'Actualización de inventario') {
  const beforeMap = new Map((beforeProducts || []).map(product => [String(product.id), normalizeProduct(product)]));
  const afterMap = new Map((afterProducts || []).map(product => [String(product.id), normalizeProduct(product)]));
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const movements = [];
  for (const id of ids) {
    const before = beforeMap.get(id);
    const after = afterMap.get(id);
    const beforeStock = Number(before?.stock || 0);
    const afterStock = Number(after?.stock || 0);
    if (beforeStock === afterStock) continue;
    const quantity = Math.abs(afterStock - beforeStock);
    movements.push({
      productId: after?.id || before?.id || id,
      sku: after?.sku || before?.sku || '',
      name: after?.name || before?.name || '',
      quantity,
      direction: afterStock < beforeStock ? 'salida' : 'entrada',
      before: beforeStock,
      after: afterStock,
      reason
    });
  }
  return movements;
}

function auditOrderSnapshot(order) {
  if (!order) return null;
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    assignedSellerId: order.assignedSellerId || null,
    assignedSellerName: order.assignedSellerName || null,
    internalNote: order.internalNote || '',
    total: Number(order.total || 0),
    items: (order.items || []).map(item => ({
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      purchaseMode: item.purchaseMode,
      quantity: Number(item.quantity || 0),
      rentalDays: item.rentalDays || null,
      deviceIdentifiers: Array.isArray(item.deviceIdentifiers) ? item.deviceIdentifiers.map(entry => ({
        unit: Number(entry.unit || 0),
        type: entry.type || null,
        primary: entry.primary || '',
        secondary: entry.secondary || null
      })) : [],
      unitPrice: Number(item.unitPrice || 0),
      subtotal: Number(item.subtotal || 0)
    }))
  };
}


const EXPENSES_FILE = path.join(DATA_DIR, 'expenses.json');
const FINES_FILE = path.join(DATA_DIR, 'fines.json');
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
// Seguridad V14: rate limiting, bloqueo progresivo y sesiones server-side.
const LOGIN_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT_MAX_ATTEMPTS = 5;
const LOGIN_IP_LIMIT_MAX_ATTEMPTS = 100;
const ACCOUNT_LOGIN_ATTEMPTS_BEFORE_LOCK = 4;
// V15.5: 4 fallos por cuenta; después bloqueo progresivo de 1, 5, 10 y 15 minutos.
const ACCOUNT_LOCKOUT_STAGES_MS = [1 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000];
const loginAttempts = new Map();
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


const USER_ROLES = new Set(['admin', 'vendedor', 'store_manager']);
const LEGACY_SELLER_ROLE = 'orders';
function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return value === LEGACY_SELLER_ROLE ? 'vendedor' : value;
}
function isSellerRole(role) {
  return normalizeRole(role) === 'vendedor';
}
function isStoreManager(role) {
  return normalizeRole(role) === 'store_manager';
}
function isAdmin(role) {
  return normalizeRole(role) === 'admin';
}


function readSecurity() {
  if (!fs.existsSync(SECURITY_FILE)) return { passkeys: {}, passkeyPolicy: {}, loginProtection: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(SECURITY_FILE, 'utf8'));
    return parsed && typeof parsed === 'object'
      ? {
          passkeys: parsed.passkeys && typeof parsed.passkeys === 'object' ? parsed.passkeys : {},
          passkeyPolicy: parsed.passkeyPolicy && typeof parsed.passkeyPolicy === 'object' ? parsed.passkeyPolicy : {},
          loginProtection: parsed.loginProtection && typeof parsed.loginProtection === 'object' ? parsed.loginProtection : {}
        }
      : { passkeys: {}, passkeyPolicy: {}, loginProtection: {} };
  } catch {
    return { passkeys: {}, passkeyPolicy: {}, loginProtection: {} };
  }
}


function writeSecurity(value) {
  const tmp = `${SECURITY_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, SECURITY_FILE);
}

function ensureSecurityFile() {
  if (!fs.existsSync(SECURITY_FILE)) writeSecurity({ passkeys: {}, passkeyPolicy: {}, loginProtection: {} });
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


// V15.5 · Motor de alertas de seguridad.
// Detecta patrones anormales a partir de la auditoría existente sin guardar
// contraseñas ni datos sensibles adicionales.
function buildSecurityAlerts(entries, users = []) {
  const now = Date.now();
  const WINDOW_15M = 15 * 60 * 1000;
  const WINDOW_30M = 30 * 60 * 1000;
  const WINDOW_10M = 10 * 60 * 1000;
  const recent = entries
    .map(entry => ({ ...entry, _ts: Date.parse(entry.createdAt || '') }))
    .filter(entry => Number.isFinite(entry._ts));

  const alerts = [];
  const roleByUsername = new Map(users.map(user => [String(user.username || '').toLowerCase(), normalizeRole(user.role)]));

  const addAlert = (severity, title, description, meta = {}) => {
    alerts.push({
      id: crypto.createHash('sha256').update(`${severity}|${title}|${description}|${meta.username || ''}|${meta.ip || ''}`).digest('hex').slice(0, 16),
      severity, title, description,
      username: meta.username || null,
      role: meta.username ? (roleByUsername.get(String(meta.username).toLowerCase()) || meta.role || null) : (meta.role || null),
      ip: meta.ip || null,
      count: meta.count || null,
      windowMinutes: meta.windowMinutes || null,
      createdAt: new Date(now).toISOString()
    });
  };

  // 1. Varios intentos fallidos sobre una misma cuenta.
  const failedByUser = new Map();
  recent.filter(e => now - e._ts <= WINDOW_15M && e.action === 'Inicio de sesión fallido')
    .forEach(e => {
      const username = String(e.username || '').toLowerCase();
      if (!username) return;
      if (!failedByUser.has(username)) failedByUser.set(username, []);
      failedByUser.get(username).push(e);
    });
  for (const [username, items] of failedByUser) {
    if (items.length >= 3) {
      addAlert(items.length >= 4 ? 'high' : 'medium',
        'Múltiples intentos de acceso fallidos',
        `Se detectaron ${items.length} intentos fallidos para esta cuenta durante los últimos 15 minutos.`,
        { username, count: items.length, windowMinutes: 15 });
    }
  }

  // 2. Una misma IP intentando entrar con varias cuentas.
  const failedByIp = new Map();
  recent.filter(e => now - e._ts <= WINDOW_15M && e.action === 'Inicio de sesión fallido' && e.ip)
    .forEach(e => {
      const ip = String(e.ip);
      if (!failedByIp.has(ip)) failedByIp.set(ip, []);
      failedByIp.get(ip).push(e);
    });
  for (const [ip, items] of failedByIp) {
    const usernames = new Set(items.map(e => String(e.username || '').toLowerCase()).filter(Boolean));
    if (items.length >= 5 && usernames.size >= 2) {
      addAlert('high',
        'Actividad de acceso inusual',
        `Se detectaron ${items.length} intentos fallidos desde la misma IP sobre ${usernames.size} cuentas distintas.`,
        { ip, count: items.length, windowMinutes: 15 });
    }
  }

  // 3. Bloqueos repetidos.
  const lockEvents = recent.filter(e => now - e._ts <= WINDOW_30M && (
    e.action === 'Cuenta bloqueada temporalmente' ||
    e.action === 'Acceso bloqueado' ||
    e.action === 'Cuenta bloqueada permanentemente'
  ));
  if (lockEvents.length >= 2) {
    addAlert(lockEvents.some(e => e.action === 'Cuenta bloqueada permanentemente') ? 'critical' : 'high',
      'Bloqueos de seguridad detectados',
      `Se registraron ${lockEvents.length} eventos de bloqueo durante los últimos 30 minutos.`,
      { count: lockEvents.length, windowMinutes: 30 });
  }

  // 4. Volumen anormal de cambios administrativos en poco tiempo.
  const sensitiveActions = recent.filter(e => now - e._ts <= WINDOW_10M && e.module !== 'Seguridad' && e.action);
  const byUser = new Map();
  sensitiveActions.forEach(e => {
    const username = String(e.username || '').toLowerCase();
    if (!username) return;
    if (!byUser.has(username)) byUser.set(username, []);
    byUser.get(username).push(e);
  });
  for (const [username, items] of byUser) {
    if (items.length >= 12) {
      addAlert('medium',
        'Actividad administrativa elevada',
        `La cuenta realizó ${items.length} acciones administrativas durante los últimos 10 minutos.`,
        { username, count: items.length, windowMinutes: 10 });
    }
  }

  // 5. Muchos cambios de inventario en una ventana corta.
  const inventoryEvents = recent.filter(e => now - e._ts <= WINDOW_10M && e.module === 'Inventario');
  if (inventoryEvents.length >= 10) {
    addAlert('medium',
      'Movimiento elevado de inventario',
      `Se registraron ${inventoryEvents.length} movimientos de inventario durante los últimos 10 minutos.`,
      { count: inventoryEvents.length, windowMinutes: 10 });
  }

  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return alerts.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
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


// V16 · Fichero de clientes: registro persistente y reutilizable de la relación comercial.
// Los datos personales se guardan cifrados igual que los datos de los pedidos.
const ENCRYPTED_CUSTOMER_FIELDS = ['name','phone','cedula','email','city','address','mapsUrl','notes'];
function encryptCustomer(customer) {
  const copy = { ...customer };
  for (const field of ENCRYPTED_CUSTOMER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(copy, field)) copy[field] = encryptOrderValue(copy[field]);
  }
  return copy;
}
function decryptCustomer(customer) {
  const copy = { ...customer };
  for (const field of ENCRYPTED_CUSTOMER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(copy, field)) copy[field] = decryptOrderValue(copy[field]);
  }
  return copy;
}
function readCustomers() {
  try {
    if (!fs.existsSync(CUSTOMERS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(decryptCustomer) : [];
  } catch { return []; }
}
function writeCustomers(customers) {
  maybeAutoBackup();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${CUSTOMERS_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(customers.map(encryptCustomer), null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, CUSTOMERS_FILE);
}
function customerIdentity(input = {}) {
  const cedula = cleanText(input.cedula, 20).replace(/\D/g, '');
  const email = cleanText(input.email, 160).toLowerCase();
  const phone = cleanText(input.phone, 50).replace(/\D/g, '');
  if (cedula) return `cedula:${cedula}`;
  if (email) return `email:${email}`;
  if (phone) return `phone:${phone}`;
  return `name:${cleanText(input.name, 120).toLowerCase()}`;
}
function upsertCustomerFromOrder(order, req = null) {
  try {
    const source = order?.customer || {};
    const identity = customerIdentity(source);
    if (!identity || identity === 'name:') return null;
    const customers = readCustomers();
    const index = customers.findIndex(customer => customer.identity === identity);
    const now = new Date().toISOString();
    const base = index >= 0 ? customers[index] : { id: crypto.randomUUID(), identity, createdAt: now };
    const next = {
      ...base,
      identity,
      name: cleanText(source.name, 120), phone: cleanText(source.phone, 50), cedula: cleanText(source.cedula, 20),
      email: cleanText(source.email, 160), city: cleanText(source.city, 80), address: cleanText(source.address, 240),
      mapsUrl: cleanText(source.mapsUrl, 500), notes: cleanText(source.notes, 1000), updatedAt: now,
      lastOrderAt: order.createdAt || now,
      orderCount: Number(base.orderCount || 0) + (index >= 0 ? 0 : 0)
    };
    // El contador se calcula dinámicamente desde pedidos; aquí solo conservamos ficha.
    if (index >= 0) customers[index] = next; else customers.unshift(next);
    writeCustomers(customers);
    return next;
  } catch (error) {
    console.error('[YHORS V16] No se pudo actualizar el fichero de clientes:', error.message);
    return null;
  }
}
function customerTransactions(customer, orders = null, sales = null) {
  const identity = customerIdentity(customer);
  const orderRows = (orders || readOrders()).filter(order => customerIdentity(order.customer || {}) === identity);
  const saleRows = (sales || readSales()).filter(sale => customerIdentity(sale.customer || {}) === identity);
  const transactions = [
    ...orderRows.map(order => ({ type: 'pedido', id: order.id, number: order.orderNumber, date: order.createdAt, status: order.status, total: Number(order.total || 0), source: order.source === 'admin_generated' ? 'Orden interna' : 'Pedido WEB' })),
    ...saleRows.map(sale => ({ type: 'venta', id: sale.id, number: sale.orderNumber, date: sale.notifiedAt || sale.createdAt, status: sale.status || 'Vendida', total: Number(sale.total || 0), source: 'Historial de ventas' }))
  ];
  const unique = new Map();
  for (const row of transactions) unique.set(`${row.type}:${row.id}`, row);
  return [...unique.values()].sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0));
}


function readPurchases() {
  try {
    if (!fs.existsSync(PURCHASES_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(PURCHASES_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function writePurchases(purchases) {
  maybeAutoBackup(); fs.mkdirSync(DATA_DIR,{recursive:true});
  const tmp=`${PURCHASES_FILE}.tmp`;
  fs.writeFileSync(tmp,`${JSON.stringify(purchases,null,2)}\n`,'utf8'); fs.renameSync(tmp,PURCHASES_FILE);
}
function nextPurchaseNumber(purchases) {
  const max=purchases.reduce((m,row)=>{const match=String(row.number||'').match(/YC-(\d+)/i);return match?Math.max(m,Number(match[1])):m;},0);
  return `YC-${String(max+1).padStart(4,'0')}`;
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
  users = users.map(user => ({ ...user, role: normalizeRole(user.role) }));
  users = ensureUserSeed(users, ADMIN_USER, 'Administrador principal', ADMIN_PASSWORD, 'admin');

  // Migración: elimina la antigua cuenta del sistema "ventas" / "Ventas / Pedidos".
  // Ya no se vuelve a crear desde variables de entorno.
  users = users.filter(user => !(user.system && user.username === 'ventas' && isSellerRole(user.role)));

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
    role: normalizeRole(user.role),
    active: user.active !== false,
    system: Boolean(user.system),
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
  const role = normalizeRole(input?.role || 'vendedor');
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
    const seedFiles = ['products.json', 'storefront.json', 'classifications.json', 'orders.json', 'sales.json', 'users.json', 'security.json', 'expenses.json', 'customers.json', 'purchases.json'];
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

  for (const fileName of ['products.json', 'storefront.json', 'classifications.json', 'orders.json', 'sales.json', 'customers.json', 'purchases.json']) {
    const target = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(target)) fs.writeFileSync(target, ['orders.json','sales.json','customers.json','purchases.json'].includes(fileName) ? '[]\n' : fileName === 'products.json' ? '[]\n' : fileName === 'storefront.json' ? '{\n  "heroProductIds": [],\n  "featuredProductIds": []\n}\n' : '{\n  "brands": {},\n  "productTypes": {}\n}\n', 'utf8');
  }
  if (!fs.existsSync(EXPENSES_FILE)) fs.writeFileSync(EXPENSES_FILE, '[]\n', 'utf8');
  if (!fs.existsSync(SALES_FILE)) fs.writeFileSync(SALES_FILE, '[]\n', 'utf8');
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
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
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
function stripText(value = '') { return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function renderDescriptionHtml(value = '') { return sanitizeDescriptionHtml(value, 2000); }
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
  return `<main class="product-detail-page"><div class="breadcrumbs"><a href="/categoria/${encodeURIComponent(product.category)}">${esc(category)}</a><span>/</span><strong>${esc(product.name)}</strong></div><section class="detail-layout"><div class="detail-gallery"><div class="detail-main-image"><img src="${esc(absoluteImage(image))}" alt="${esc(product.name)}" width="800" height="800"></div>${images.length > 1 ? `<div class="thumbnail-row">${images.slice(1,4).map((url,i)=>`<img src="${esc(absoluteImage(url))}" alt="${esc(product.name)} - imagen ${i+2}" width="200" height="200">`).join('')}</div>`:''}</div><div class="detail-copy"><span class="eyebrow">${esc(category)}</span><h1>${esc(product.name)}</h1><div class="detail-price">$${price.toFixed(2)}</div>${rental}<div class="detail-sku"><span>SKU: <strong>${esc(product.sku || '—')}</strong></span></div><div class="detail-divider"></div><h2>Descripción</h2><div class="detail-description">${renderDescriptionHtml(product.description)}</div><div class="detail-buy"><a class="button" href="/categoria/${encodeURIComponent(product.category)}">Ver más productos <span>→</span></a></div></div></section></main>`;
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
// V14.24 PDF orden

// V14.24 PDF orden — generador PDF ligero, sin dependencia externa.
function pdfEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\xFF]/g, '?');
}

function buildOrderPdf(order) {
  const customer = order?.customer || {};
  const items = Array.isArray(order?.items) ? order.items : [];
  const orderNo = String(order?.orderNumber || order?.id || '');
  const assignedSeller = order?.assignedSellerId
    ? readUsers().find(user => user.id === order.assignedSellerId)
    : null;
  const seller = assignedSeller?.name || order?.assignedSellerName || order?.assignedSeller?.name || 'Sin asignar';
  const created = order?.createdAt ? new Date(order.createdAt) : null;
  const date = created && !Number.isNaN(created.getTime())
    ? (() => {
        const parts = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(created);
        const get = type => parts.find(part => part.type === type)?.value || '';
        return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
      })()
    : '';
  const subtotal = Number(order?.subtotal ?? order?.total ?? 0);
  const shipping = Number(order?.shippingCost ?? order?.delivery?.cost ?? 0);
  const total = Number(order?.total ?? 0);
  const status = String(order?.status || 'Pendiente');
  const deliveryLabel = String(order?.delivery?.label || 'No especificada');
  const customerNotes = String(customer?.notes || '');
  const internalNote = String(order?.internalNote || '');

  const W = 595;
  const H = 842;
  const margin = 38;
  const right = W - margin;
  const contentWidth = right - margin;
  const normalFont = 1;
  const boldFont = 2;
  const imageWidth = 150;
  const imageHeight = 33;
  const logoPath = path.join(__dirname, 'public', 'assets', 'yhors-logo-pdf.jpg');
  let logoJpeg = null;
  try { logoJpeg = fs.readFileSync(logoPath); } catch { logoJpeg = null; }

  const wrap = (text, maxChars) => {
    const value = String(text ?? '').trim();
    if (!value) return [''];
    const words = value.split(/\s+/);
    const result = [];
    let current = '';
    for (const word of words) {
      if (!current) current = word;
      else if ((current + ' ' + word).length <= maxChars) current += ' ' + word;
      else { result.push(current); current = word; }
    }
    if (current) result.push(current);
    return result;
  };

  const moneyPdf = value => `$${Number(value || 0).toFixed(2)}`;
  // En el documento mostramos un SKU corto y legible. El SKU completo sigue
  // existiendo en el producto/pedido; aquí solo evitamos que invada las otras columnas.
  const shortSku = value => {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const parts = raw.split('-').filter(Boolean);
    if (parts.length >= 3) return parts.slice(0, 3).join('-');
    if (parts.length === 2) return parts.join('-');
    return raw.length > 12 ? `${raw.slice(0, 12)}…` : raw;
  };
  const safeStatus = status.toLocaleUpperCase('es-EC');

  // Each row is a compact set of lines. A row never gets split between pages.
  const rows = items.map((item, index) => {
    const qty = Number(item.quantity || 0);
    const name = String(item.name || item.productName || item.sku || 'Producto');
    const sku = shortSku(item.sku);
    const price = Number(item.unitPrice ?? item.price ?? 0);
    const lineTotal = Number(item.subtotal ?? item.lineTotal ?? item.total ?? price * qty);
    const mode = item.purchaseMode === 'rental'
      ? `Alquiler - ${Math.max(1, Number(item.rentalDays || 1))} dia(s)`
      : 'Compra';
    const identifierText = (item.deviceIdentifiers || []).map(entry => `${entry.type === 'imei' ? 'IMEI' : 'Serie'} ${entry.unit}: ${entry.primary}${entry.secondary ? ` / ${entry.secondary}` : ''}`).join(' · ');
    const descriptionText = `${name}${mode !== 'Compra' ? ` (${mode})` : ''}${identifierText ? ` | ${identifierText}` : ''}`;
    return {
      index: index + 1,
      sku,
      qty,
      name,
      price,
      lineTotal,
      mode,
      descLines: wrap(descriptionText, 44)
    };
  });

  const pages = [];
  let currentRows = [];
  let estimated = 0;
  const maxRowsHeight = 560;
  for (const row of rows) {
    const rowHeight = Math.max(28, row.descLines.length * 10 + 18);
    if (currentRows.length && estimated + rowHeight > maxRowsHeight) {
      pages.push(currentRows);
      currentRows = [];
      estimated = 0;
    }
    currentRows.push(row);
    estimated += rowHeight;
  }
  if (currentRows.length || !pages.length) pages.push(currentRows);

  const drawText = (ops, text, x, y, size = 9, font = normalFont, align = 'left') => {
    const value = pdfEscape(text);
    const approxWidth = String(text ?? '').length * size * 0.52;
    let tx = x;
    if (align === 'right') tx = x - approxWidth;
    if (align === 'center') tx = x - approxWidth / 2;
    ops.push(`BT /F${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${value}) Tj ET`);
  };
  const line = (ops, x1, y1, x2, y2, width = 0.7) => ops.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (ops, x, y, w, h, width = 0.7) => ops.push(`${width} w ${x} ${y} ${w} ${h} re S`);
  const fillRect = (ops, x, y, w, h, r = 0.96, g = 0.95, b = 0.92) => {
    ops.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f 0 0 0 rg`);
  };
  const setFill = (ops, r, g, b) => ops.push(`${r} ${g} ${b} rg`);
  const setStroke = (ops, r, g, b) => ops.push(`${r} ${g} ${b} RG`);

  const contentStreams = [];
  pages.forEach((pageRows, pageIndex) => {
    const ops = [];
    let y = H - margin;
    setStroke(ops, 0.12, 0.12, 0.12);
    setFill(ops, 0, 0, 0);

    // Header: logo + document identity, inspired by a formal invoice layout.
    if (logoJpeg) {
      ops.push(`q ${imageWidth} 0 0 ${imageHeight} ${margin} ${y - imageHeight + 4} cm /Im1 Do Q`);
    } else {
      drawText(ops, 'YHORS', margin, y - 10, 24, boldFont);
    }
    // Encabezado: los tres textos se alinean por su BORDE DERECHO con
    // el borde derecho del recuadro PENDIENTE. No se centra el texto sobre
    // el recuadro; todos terminan exactamente en la misma vertical.
    const statusW = 116;
    const statusX = right - statusW;
    const headerRight = statusX + statusW;

    // Ajustes finos del encabezado:
    // cada línea tiene su propio desplazamiento horizontal para conservar
    // el centrado visual solicitado sin mover el recuadro PENDIENTE.
    const titleRight = headerRight - 25;
    const orderRight = headerRight - 3;
    const dateRight = headerRight + 4;
    drawText(ops, 'ORDEN DE PEDIDO', titleRight, y - 8, 18, boldFont, 'right');
    drawText(ops, `N. ORDEN  ${orderNo}`, orderRight, y - 29, 9, boldFont, 'right');
    drawText(ops, `FECHA  ${date}`, dateRight, y - 44, 8, normalFont, 'right');
    setFill(ops, 0.78, 0.60, 0.24);
    ops.push(`0.78 0.60 0.24 rg ${statusX} ${y - 68} ${statusW} 18 re f 0 0 0 rg`);
    drawText(ops, safeStatus, statusX + statusW / 2, y - 62, 8, boldFont, 'center');
    y -= 85;
    line(ops, margin, y, right, y, 1.1);
    y -= 14;

    // Seller / dispatch block.
    const sellerBoxH = 48;
    fillRect(ops, margin, y - sellerBoxH, contentWidth, sellerBoxH, 0.985, 0.98, 0.96);
    rect(ops, margin, y - sellerBoxH, contentWidth, sellerBoxH, 0.8);
    drawText(ops, 'CONTROL DE DESPACHO', margin + 9, y - 14, 8, boldFont);
    drawText(ops, `VENDEDOR: ${seller}`, margin + 9, y - 29, 8, normalFont);
    drawText(ops, `ENTREGA: ${deliveryLabel}`, right - 18, y - 29, 8, normalFont, 'right');
    drawText(ops, `ESTADO DE DESPACHO: ${status === 'Pendiente' ? 'PENDIENTE' : safeStatus}`, margin + 9, y - 42, 7, boldFont);
    y -= sellerBoxH + 13;

    // Customer block: compact label/value spacing for a cleaner commercial document.
    const customerBoxH = 90;
    rect(ops, margin, y - customerBoxH, contentWidth, customerBoxH, 0.8);
    const mid = margin + contentWidth * 0.55;
    line(ops, mid, y, mid, y - customerBoxH, 0.6);
    drawText(ops, 'DATOS DEL CLIENTE', margin + 9, y - 14, 9, boldFont);
    const labelValue = (label, value, x, baseY, labelSize = 7, valueSize = 8, valueFont = normalFont, maxX = right) => {
      const labelWidth = String(label).length * labelSize * 0.52;
      const valueX = x + labelWidth + 6;
      const maxChars = Math.max(10, Math.floor((maxX - valueX) / (valueSize * 0.52)));
      const lines = wrap(value || '-', maxChars);
      drawText(ops, label, x, baseY, labelSize, normalFont);
      lines.slice(0, 2).forEach((text, i) => drawText(ops, text, valueX, baseY - i * 10, valueSize, valueFont));
    };
    labelValue('Nombre / Razon social:', customer.name, margin + 9, y - 31, 7, 7.8, boldFont, mid - 8);
    labelValue('Cedula / RUC:', customer.cedula, margin + 9, y - 46, 7, 7.8, boldFont, mid - 8);
    labelValue('Telefono:', customer.phone, margin + 9, y - 61, 7, 7.8, normalFont, mid - 8);
    labelValue('Correo:', customer.email, margin + 9, y - 76, 7, 7.8, normalFont, mid - 8);
    labelValue('Ciudad:', customer.city, mid + 9, y - 31, 7, 7.8, boldFont, right - 8);
    labelValue('Direccion:', customer.address || 'No registrada', mid + 9, y - 46, 7, 7.5, normalFont, right - 8);
    labelValue('Referencia:', deliveryLabel, mid + 9, y - 71, 7, 7.5, normalFont, right - 8);
    y -= customerBoxH + 14;

    // Products table.
    drawText(ops, 'DETALLE DE LA ORDEN', margin, y, 9, boldFont);
    y -= 10;
    const headerH = 22;
    fillRect(ops, margin, y - headerH, contentWidth, headerH, 0.94, 0.93, 0.89);
    rect(ops, margin, y - headerH, contentWidth, headerH, 0.75);
    const cols = [margin, margin + 70, margin + 104, margin + 355, margin + 430, right];
    ['CODIGO', 'CANT', 'DESCRIPCION', 'P. UNIT.', 'TOTAL'].forEach((label, i) => {
      const centers = [null, (cols[1] + cols[2]) / 2, null, (cols[3] + cols[4]) / 2, (cols[4] + cols[5]) / 2];
      if (i === 0 || i === 2) drawText(ops, label, i === 0 ? cols[0] + 5 : cols[2] + 5, y - 14, 7, boldFont, 'left');
      else drawText(ops, label, centers[i], y - 14, i === 1 ? 7 : 7, boldFont, 'center');
    });
    cols.slice(1, -1).forEach(x => line(ops, x, y, x, y - headerH, 0.5));
    y -= headerH;

    for (const row of pageRows) {
      const rowH = Math.max(28, row.descLines.length * 10 + 18);
      const top = y;
      line(ops, margin, y - rowH, right, y - rowH, 0.5);
      cols.slice(1, -1).forEach(x => line(ops, x, y, x, y - rowH, 0.5));
      drawText(ops, row.sku, margin + 5, top - 14, 6.5, normalFont);
      drawText(ops, String(row.qty), (cols[1] + cols[2]) / 2, top - 14, 7.5, boldFont, 'center');
      row.descLines.forEach((text, i) => drawText(ops, text, cols[2] + 5, top - 12 - i * 10, 7.5, i === 0 ? boldFont : normalFont));
      drawText(ops, moneyPdf(row.price), cols[4] - 8, top - 14, 7.5, normalFont, 'right');
      drawText(ops, moneyPdf(row.lineTotal), right - 7, top - 14, 7.5, boldFont, 'right');
      y -= rowH;
    }

    // Totals and observations on each page. Totals are only on the final page.
    if (pageIndex === pages.length - 1) {
      y -= 12;
      const totalsW = 190;
      const totalsX = right - totalsW;
      drawText(ops, 'RESUMEN', totalsX, y, 8, boldFont);
      y -= 7;
      rect(ops, totalsX, y - 73, totalsW, 73, 0.8);
      drawText(ops, 'SUBTOTAL', totalsX + 9, y - 16, 8, normalFont);
      drawText(ops, moneyPdf(subtotal), right - 9, y - 16, 8, normalFont, 'right');
      drawText(ops, 'ENVIO', totalsX + 9, y - 31, 8, normalFont);
      drawText(ops, moneyPdf(shipping), right - 9, y - 31, 8, normalFont, 'right');
      line(ops, totalsX + 8, y - 39, right - 8, y - 39, 0.5);
      drawText(ops, 'TOTAL', totalsX + 9, y - 57, 10, boldFont);
      drawText(ops, moneyPdf(total), right - 9, y - 57, 11, boldFont, 'right');
      y -= 87;

      const noteText = customerNotes || internalNote;
      if (noteText) {
        drawText(ops, 'OBSERVACIONES', margin, y, 8, boldFont);
        y -= 7;
        const noteLines = wrap(noteText, 88).slice(0, 5);
        const noteH = Math.max(32, noteLines.length * 10 + 12);
        rect(ops, margin, y - noteH, contentWidth, noteH, 0.65);
        noteLines.forEach((t, i) => drawText(ops, t, margin + 8, y - 14 - i * 10, 7.5, normalFont));
        y -= noteH + 13;
      }

      // Signature / dispatch confirmation area.
      const sigY = Math.max(60, y - 45);
      line(ops, margin, sigY, margin + 175, sigY, 0.6);
      line(ops, right - 175, sigY, right, sigY, 0.6);
      drawText(ops, 'Responsable de despacho', margin + 87, sigY - 13, 7, normalFont, 'center');
      drawText(ops, 'Recepcion / conformidad', right - 87, sigY - 13, 7, normalFont, 'center');
      drawText(ops, `Documento interno YHORS - ${orderNo}`, margin, 28, 6.5, normalFont);
      drawText(ops, `Pagina ${pageIndex + 1} de ${pages.length}`, right, 28, 6.5, normalFont, 'right');
    } else {
      drawText(ops, `Continua en la pagina ${pageIndex + 2}`, right, 28, 6.5, normalFont, 'right');
    }

    contentStreams.push(ops.join('\n'));
  });

  // PDF objects. Pages/contents are created first; image and fonts are shared.
  const pageCount = contentStreams.length;
  const imageObjectNumber = 3 + pageCount * 2;
  const normalFontObjectNumber = imageObjectNumber + 1;
  const boldFontObjectNumber = imageObjectNumber + 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`
  ];
  const pageObjects = [];
  contentStreams.forEach((stream, i) => {
    const pageNumber = 3 + i * 2;
    const contentNumber = pageNumber + 1;
    pageObjects.push({ pageNumber, contentNumber, stream });
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /ProcSet [/PDF /Text /ImageC] /Font << /F1 ${normalFontObjectNumber} 0 R /F2 ${boldFontObjectNumber} 0 R >> /XObject << /Im1 ${imageObjectNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  if (logoJpeg) {
    objects.push(`<< /Type /XObject /Subtype /Image /Width 839 /Height 184 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpeg.length} >>\nstream\n${logoJpeg.toString('latin1')}\nendstream`);
  } else {
    objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n\xff\xff\xff\nendstream');
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}



// Flyer PDF server-side: genera el PDF real (como las órdenes) y lo entrega inline
// para que el navegador abra directamente el documento PDF en una pestaña nueva.
function parseJpegSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && length >= 7) return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    offset += length;
  }
  return null;
}

function flyerImageTool() {
  // Docker instala ImageMagick con apk; algunos entornos lo exponen como magick y
  // otros conservan convert. No depender de /opt/... evita que el PDF pierda imágenes.
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore', timeout: 5000 });
    return 'magick';
  } catch {}
  try {
    execFileSync('convert', ['-version'], { stdio: 'ignore', timeout: 5000 });
    return 'convert';
  } catch {}
  return null;
}

function flyerIsJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 10 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}

function flyerIsPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
}

function flyerIsWebp(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

async function flyerImageJpeg(url) {
  try {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) return null;

    let input = null;
    if (rawUrl.startsWith('data:image/')) {
      const comma = rawUrl.indexOf(',');
      if (comma > 0) {
        input = Buffer.from(rawUrl.slice(comma + 1), rawUrl.slice(0, comma).includes(';base64') ? 'base64' : 'utf8');
      }
    } else if (rawUrl.startsWith('/uploads/')) {
      const local = path.join(UPLOADS_DIR, path.basename(rawUrl));
      if (fs.existsSync(local)) input = fs.readFileSync(local);
    } else {
      const target = absoluteImage(rawUrl);
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': SITE_URL + '/'
      };
      // Try the original first, then force a real JPEG through the image proxy.
      // Some product hosts (Pinterest/AVIF/WebP endpoints) return a format that
      // the server-side ImageMagick build cannot decode reliably. The proxy is
      // asked explicitly for JPG so the PDF always receives a PDF-safe image.
      const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(target)}&output=jpg&q=90&w=1600`;
      const proxyUrl2 = `https://images.weserv.nl/?url=${encodeURIComponent(target)}&output=jpg&q=90&w=1600`;
      const candidates = [proxyUrl, proxyUrl2, target];
      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, {
            headers: candidate === target ? headers : { 'User-Agent': headers['User-Agent'], 'Accept': 'image/jpeg,image/*,*/*;q=0.8' },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
          });
          if (!response.ok) continue;
          const bytes = Buffer.from(await response.arrayBuffer());
          const type = String(response.headers.get('content-type') || '').toLowerCase();
          const looksLikeImage = flyerIsJpeg(bytes) || flyerIsPng(bytes) || flyerIsWebp(bytes) || type.startsWith('image/');
          if (bytes.length > 100 && looksLikeImage) {
            input = bytes;
            break;
          }
        } catch (_) {}
      }
    }

    if (!input || input.length < 100) return null;

    // JPEG can be embedded directly. This avoids a second conversion step and,
    // importantly, prevents ImageMagick from trying to decode an already-valid
    // JPEG data URL and producing the blank image seen in the flyer PDF.
    if (flyerIsJpeg(input)) {
      const size = parseJpegSize(input);
      if (size) return { data: input, width: size.width, height: size.height };
    }

    const tool = flyerImageTool();
    if (!tool) {
      console.warn('[YHORS] ImageMagick no está disponible para el PDF del flyer.');
      return null;
    }
    const jpeg = execFileSync(tool, [
      '-', '-auto-orient', '-colorspace', 'sRGB', '-alpha', 'remove',
      '-background', 'white', '-flatten', '-strip', '-quality', '90', 'jpg:-'
    ], { input, timeout: 25000, maxBuffer: 32 * 1024 * 1024 });
    const size = parseJpegSize(jpeg);
    return size ? { data: jpeg, width: size.width, height: size.height } : null;
  } catch (error) {
    console.warn('[YHORS] Flyer image skipped:', String(error?.message || error).slice(0, 320));
    return null;
  }
}

function hexRgb(hex, fallback = [0.71, 0.54, 0.26]) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return fallback;
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
}

function flyerProductHighlights(product) {
  const raw = String(product?.description || '').replace(/\r/g, '');
  if (!raw) return [];
  return raw.split(/\n|•|\s+-\s+/).map(x => x.replace(/^[-–—*]\s*/, '').trim()).filter(Boolean).slice(0, 5);
}

function flyerWrap(text, maxChars) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return [];
  const words = value.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if ((current + ' ' + word).length <= maxChars) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

function flyerPdfText(ops, text, x, y, size = 8, font = 1, align = 'left') {
  const raw = String(text ?? '');
  const value = pdfEscape(raw);
  const approx = raw.length * size * 0.50;
  let tx = x;
  if (align === 'right') tx = x - approx;
  if (align === 'center') tx = x - approx / 2;
  ops.push(`BT /F${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${value}) Tj ET`);
}

function flyerFill(ops, r, g, b) { ops.push(`${r} ${g} ${b} rg`); }
function flyerStroke(ops, r, g, b) { ops.push(`${r} ${g} ${b} RG`); }
function flyerLine(ops, x1, y1, x2, y2, width = 0.5) { ops.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`); }
function flyerRect(ops, x, y, w, h, width = 0.6) { ops.push(`${width} w ${x} ${y} ${w} ${h} re S`); }
function flyerRoundRect(ops, x, y, w, h, r = 6, fill = false, width = 0.6) {
  // Rounded rectangle with genuinely straight sides and only the four corners
  // rounded. The previous PDF version used a larger/visually heavier curve
  // that made the card sides look bowed.
  const k = 0.5522847498;
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const c = rr * k;
  ops.push(`${width} w ${x + rr} ${y} m ${x + w - rr} ${y}`);
  ops.push(`${x + w - rr + c} ${y} ${x + w} ${y + rr - c} ${x + w} ${y + rr} c`);
  ops.push(`${x + w} ${y + h - rr} l`);
  ops.push(`${x + w} ${y + h - rr + c} ${x + w - rr + c} ${y + h} ${x + w - rr} ${y + h} c`);
  ops.push(`${x + rr} ${y + h} l`);
  ops.push(`${x + rr - c} ${y + h} ${x} ${y + h - rr + c} ${x} ${y + h - rr} c`);
  ops.push(`${x} ${y + rr} l`);
  ops.push(`${x} ${y + rr - c} ${x + rr - c} ${y} ${x + rr} ${y} c`);
  ops.push(fill ? 'f' : 'S');
}

function flyerTopPanel(ops, x, y, w, h, r = 7) {
  // Cream image panel: rounded only at the top corners, straight on the
  // bottom edge so it reads like the elegant preview card.
  const k = 0.5522847498;
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const c = rr * k;
  // Preview uses a warm cream image panel; keep the PDF identical.
  ops.push(`0.965 0.95 0.92 rg`);
  ops.push(`${x} ${y} m ${x + w} ${y} l ${x + w} ${y + h - rr} l`);
  ops.push(`${x + w} ${y + h - rr + c} ${x + w - rr + c} ${y + h} ${x + w - rr} ${y + h} c`);
  ops.push(`${x + rr} ${y + h} l`);
  ops.push(`${x + rr - c} ${y + h} ${x} ${y + h - rr + c} ${x} ${y + h - rr} c`);
  ops.push(`h f`);
}


async function buildFlyerPdf({ products, title, subtitle, description, layout, orientation, showPrices, theme, accent, logo, contact, contactName, notes }) {
  const isLandscape = orientation === 'landscape';
  const W = isLandscape ? 842 : 595;
  const H = isLandscape ? 595 : 842;
  const margin = isLandscape ? 34 : 32;
  const contentW = W - margin * 2;
  const [ar, ag, ab] = hexRgb(accent);
  const safeLayout = ['1','2','3','4'].includes(String(layout)) ? String(layout) : '4';
  const cleanProducts = Array.isArray(products) ? products : [];
  const imageCache = new Map();

  for (const product of cleanProducts) {
    if (product.imageData) {
      if (!imageCache.has(product.imageData)) imageCache.set(product.imageData, await flyerImageJpeg(product.imageData));
    }
    const urls = [...new Set([
      ...(Array.isArray(product.images) ? product.images : []),
      product.image || ''
    ].filter(Boolean))].slice(0, 4);
    for (const url of urls) {
      if (!imageCache.has(url)) imageCache.set(url, await flyerImageJpeg(url));
    }
  }

  const logoPath = path.join(__dirname, 'public', 'assets', 'yhors-logo-pdf.jpg');
  let logoJpeg = null;
  try { logoJpeg = fs.readFileSync(logoPath); } catch {}
  const logoSize = logoJpeg ? parseJpegSize(logoJpeg) : null;

  // Match the compact, elegant preview density in the real PDF. Portrait
  // flyers can use three rows for the 4-column layout (12 products/page),
  // while landscape keeps the more open 2-row composition.
  const config = isLandscape ? {
    '4': { cols: 4, rows: 2, mode: 'grid', perPage: 8 },
    '3': { cols: 3, rows: 2, mode: 'grid', perPage: 6 },
    '2': { cols: 2, rows: 2, mode: 'horizontal', perPage: 4 },
    '1': { cols: 1, rows: 1, mode: 'featured', perPage: 1 }
  }[safeLayout] : {
    '4': { cols: 4, rows: 3, mode: 'grid', perPage: 12 },
    '3': { cols: 3, rows: 3, mode: 'grid', perPage: 9 },
    '2': { cols: 2, rows: 3, mode: 'horizontal', perPage: 6 },
    '1': { cols: 1, rows: 1, mode: 'featured', perPage: 1 }
  }[safeLayout];
  const pages = [];
  for (let i = 0; i < Math.max(1, cleanProducts.length); i += config.perPage) pages.push(cleanProducts.slice(i, i + config.perPage));
  if (!pages.length) pages.push([]);

  const streams = [];
  const usedImages = [];

  const drawLines = (ops, text, x, y, maxChars, size, font, color, maxLines, lineGap = size + 3) => {
    flyerFill(ops, ...color);
    const lines = flyerWrap(text, Math.max(8, maxChars)).slice(0, maxLines);
    lines.forEach(line => { flyerPdfText(ops, line, x, y, size, font); y -= lineGap; });
    return { y, lines };
  };

  const drawProduct = (ops, product, globalIndex, x, y, w, h, mode) => {
    const gap = 8;
    // Marco del producto: usar el marco completo de la versión que gustó en la
    // vista previa. El borde debe encerrar imagen + ficha + precio como una sola
    // tarjeta; el borde se vuelve a dibujar al final para que ningún fondo de la
    // zona de imagen lo tape.
    flyerFill(ops, 1, 1, 1);
    flyerStroke(ops, 0.88, 0.86, 0.82);
    flyerRoundRect(ops, x, y, w, h, 6, true, 0.65);

    const imageUrls = [...new Set([
      product.imageData || '',
      ...(Array.isArray(product.images) ? product.images : []),
      product.image || ''
    ].filter(Boolean))].slice(0, 5);
    const image = imageUrls.map(url => imageCache.get(url)).find(Boolean) || null;

    let imageX = x, imageY = y, imageW = w, imageH = h;
    let copyX = x, copyY = y + h, copyW = w;
    if (mode === 'grid') {
      imageH = Math.min(h * 0.38, safeLayout === '4' ? 112 : 175);
      // PDF coordinates start at the bottom-left. The preview places the image
      // in the TOP section of the card, so the image box must start at the top
      // of the card rather than at `y`. The previous value made the image render
      // over the product copy/price even though the background rectangle was up top.
      imageY = y + h - imageH;
      copyY = imageY - 10;
      copyX = x + 10; copyW = w - 20;
      // Panel de imagen: mismo lenguaje visual de la vista previa: crema,
      // limpio y recto en la parte inferior, con curvas discretas solo arriba.
      flyerFill(ops, 0.965, 0.95, 0.92);
      flyerTopPanel(ops, imageX + 0.6, imageY, imageW - 1.2, imageH, 7);
    } else if (mode === 'horizontal') {
      // Layout 2: reproduce the elegant preview card: a cream/gold-tinted
      // image column on the left, white commercial copy on the right, one
      // continuous rounded border around the complete product card.
      imageW = w * 0.42;
      copyX = x + imageW + 10;
      copyW = w - imageW - 20;
      copyY = y + h - 15;
      flyerFill(ops, 0.965, 0.95, 0.92);
      flyerRoundRect(ops, x + 0.5, y + 0.5, imageW, h - 1, 7, true, 0.35);
      flyerStroke(ops, 0.91, 0.88, 0.83);
      flyerLine(ops, x + imageW, y + 8, x + imageW, y + h - 8, 0.45);
    } else {
      // Featured / 1-product layout: give the commercial column a little more
      // breathing room so long titles can wrap elegantly instead of escaping
      // the card. The image column remains generous, but the copy gets the
      // width needed for title + SKU + description.
      imageW = w * 0.43;
      copyX = x + imageW + 18;
      copyW = w - imageW - 30;
      copyY = y + h - 28;
      flyerFill(ops, 0.965, 0.95, 0.92); flyerRoundRect(ops, x, y, imageW, h, 6, true);
      flyerStroke(ops, 0.91, 0.88, 0.83); flyerRoundRect(ops, x, y, imageW, h, 6, false);
    }

    if (image) {
      const objName = `Im${usedImages.length + 1}`;
      usedImages.push({ name: objName, image });
      const pad = mode === 'featured' ? 14 : 6;
      const boxX = imageX + pad, boxY = imageY + pad, boxW = imageW - pad * 2, boxH = imageH - pad * 2;
      const scale = Math.min(boxW / image.width, boxH / image.height);
      const drawW = Math.max(1, image.width * scale), drawH = Math.max(1, image.height * scale);
      const dx = boxX + (boxW - drawW) / 2, dy = boxY + (boxH - drawH) / 2;
      ops.push(`q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm /${objName} Do Q`);
    }

    // Promotional note: mirror the live preview exactly by placing the
    // per-product promotion as a gold ribbon over the bottom of the image
    // panel. Previously it was drawn inside the copy area only when there
    // happened to be enough vertical space, so compact PDFs could silently
    // lose labels such as “ULTIMA UNIDAD”.
    const note = String(notes?.[String(product.id)] || '').replace(/\s+/g, ' ').trim();
    if (note) {
      const ribbonH = mode === 'featured' ? 24 : 18;
      const ribbonY = imageY;
      flyerFill(ops, ar, ag, ab);
      ops.push(`${imageX} ${ribbonY} ${imageW} ${ribbonH} re f`);
      flyerFill(ops, 1, 1, 1);
      const promoSize = mode === 'featured' ? 7.2 : 5.6;
      const promoMax = mode === 'featured' ? 58 : safeLayout === '4' ? 28 : 42;
      flyerPdfText(ops, trim(note.toUpperCase(), promoMax), imageX + imageW / 2, ribbonY + (ribbonH - promoSize) / 2 + 1.5, promoSize, 2, 'center');
    }

    flyerFill(ops, ar, ag, ab); flyerRoundRect(ops, x + 8, y + h - 25, 25, 17, 8, true);
    flyerFill(ops, 1, 1, 1); flyerPdfText(ops, String(globalIndex + 1).padStart(2, '0'), x + 20.5, y + h - 19.5, 6, 2, 'center');

    const brand = String(product.brand || '').trim() || 'YHORS';
    const titleSize = mode === 'featured' ? 17.5 : safeLayout === '2' ? 11.2 : safeLayout === '3' ? 9.3 : 8.0;
    // Character counts are derived from the actual copy width so Helvetica
    // cannot run past the right border. Featured titles get up to 3 lines;
    // compact layouts stay intentionally tighter.
    const charsFor = (width, size, factor = 0.50) => Math.max(10, Math.floor(width / Math.max(1, size * factor)));
    const titleChars = mode === 'featured' ? charsFor(copyW, titleSize, 0.52) : safeLayout === '2' ? charsFor(copyW, titleSize, 0.52) : safeLayout === '3' ? charsFor(copyW, titleSize, 0.52) : charsFor(copyW, titleSize, 0.52);
    const titleLines = mode === 'featured' ? 3 : safeLayout === '2' ? 3 : 2;
    const metaSize = mode === 'featured' ? 8 : safeLayout === '2' ? 6.3 : 5.6;
    const highlightSize = mode === 'featured' ? 7.6 : safeLayout === '2' ? 6.2 : safeLayout === '3' ? 5.8 : 5.35;
    const maxHighlights = 5;
    const trim = (value, max) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (text.length <= max) return text;
      return text.slice(0, Math.max(1, max - 1)).replace(/\s+$/, '') + '…';
    };
    let cy = copyY;

    flyerFill(ops, ar, ag, ab);
    flyerPdfText(ops, trim(brand.toUpperCase(), 20), copyX, cy, mode === 'featured' ? 7.5 : 5.7, 2);
    cy -= mode === 'featured' ? 16 : 11;

    const titleResult = drawLines(ops, product.name || 'Producto', copyX, cy, titleChars, titleSize, 2, [0.08,0.075,0.07], titleLines, titleSize + 2);
    cy = titleResult.y - 2;

    // Keep type and SKU on their own compact lines, as in the preview. This
    // avoids the old "product type · SKU" line overflowing the card.
    const typeText = trim(product.productType || 'Producto', safeLayout === '4' ? 20 : 28);
    const skuText = product.sku ? `SKU ${trim(product.sku, safeLayout === '4' ? 22 : 34)}` : '';
    flyerFill(ops, 0.45,0.43,0.40);
    if (typeText) { flyerPdfText(ops, typeText, copyX, cy, metaSize, 1); cy -= metaSize + 3; }
    if (skuText) { flyerPdfText(ops, skuText, copyX, cy, metaSize, 1); cy -= metaSize + 4; }

    // The description gets a subtle right indent so it reads as a separate
    // commercial block and remains light/elegant rather than bold.
    const highlights = flyerProductHighlights(product).slice(0, maxHighlights);
    let descriptionLinesUsed = 0;
    const descriptionMaxLines = 5;
    for (const item of highlights) {
      if (cy < y + (mode === 'featured' ? 58 : 28) || descriptionLinesUsed >= descriptionMaxLines) break;
      const bullet = `• ${item}`;
      const chars = charsFor(copyW - 5, highlightSize, 0.50);
      const remaining = Math.max(1, descriptionMaxLines - descriptionLinesUsed);
      const result = drawLines(ops, bullet, copyX + 6, cy, chars, highlightSize, 1, [0.38,0.36,0.33], Math.min(2, remaining), highlightSize + 2.2);
      descriptionLinesUsed += result.lines.length;
      cy = result.y - 0.5;
    }

    if (showPrices) {
      const price = Number(product.salePrice ?? product.price ?? 0);
      const priceSize = mode === 'featured' ? 18 : safeLayout === '2' ? 12 : safeLayout === '3' ? 10.5 : 10;
      // Price is anchored close to the card bottom, matching the preview
      // instead of floating halfway up when the description is short.
      const priceY = y + (mode === 'featured' ? 20 : 13);
      flyerFill(ops, ar, ag, ab);
      flyerPdfText(ops, `$${price.toFixed(2)}`, copyX, priceY, priceSize, 2);
    }

    // Redibujar el borde exterior al final: así el marco continúa claramente
    // por los laterales y llega hasta debajo del precio, sin ser cortado por
    // el panel de imagen ni por los textos.
    flyerStroke(ops, 0.88, 0.86, 0.82);
    flyerRoundRect(ops, x, y, w, h, 6, false, 0.65);
  };

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const ops = [];
    flyerFill(ops, 1, 1, 1); ops.push(`0 0 ${W} ${H} re f`);
    let headerY = H - margin;
    if (logo && logoJpeg && logoSize) {
      const lw = isLandscape ? 72 : 68, lh = lw * logoSize.height / logoSize.width;
      ops.push(`q ${lw} 0 0 ${lh} ${margin} ${headerY - lh + 3} cm /Logo Do Q`);
    } else if (logo) {
      flyerFill(ops, 0.07, 0.065, 0.06); flyerPdfText(ops, 'YHORS', margin, headerY - 12, 18, 2);
    }
    const headerX = logo ? margin + (isLandscape ? 92 : 88) : margin;
    flyerFill(ops, ar, ag, ab); flyerPdfText(ops, 'YHORS · SELECCIÓN COMERCIAL', headerX, headerY - 4, 7, 2);
    flyerFill(ops, 0.06, 0.055, 0.05);
    const titleMax = isLandscape ? 70 : 48;
    drawLines(ops, title || 'Recién Llegados', headerX, headerY - 28, titleMax, isLandscape ? 27 : 25, 2, [0.06,0.055,0.05], 2, isLandscape ? 29 : 27);
    let hy = headerY - 55;
    if (subtitle) { flyerFill(ops, 0.36,0.34,0.31); flyerPdfText(ops, String(subtitle).slice(0, 140), headerX, hy, 8, 1); hy -= 13; }
    if (description) { hy = drawLines(ops, description, headerX, hy, isLandscape ? 100 : 72, 6.8, 1, [0.42,0.39,0.36], 2, 9).y; }
    flyerFill(ops, 0.45,0.43,0.40); flyerPdfText(ops, new Intl.DateTimeFormat('es-EC',{dateStyle:'medium'}).format(new Date()), W - margin, headerY - 4, 7, 1, 'right');
    flyerPdfText(ops, `PÁGINA ${pageIndex + 1} / ${pages.length}`, W - margin, headerY - 17, 6, 1, 'right');
    const headerBottom = Math.min(hy, headerY - 55);
    flyerStroke(ops, 0.86,0.83,0.78); flyerLine(ops, margin, headerBottom - 8, W - margin, headerBottom - 8, 0.7);

    const top = headerBottom - 16;
    const footerH = 24;
    const availableH = Math.max(180, top - margin - footerH);
    const gap = safeLayout === '1' ? 0 : 10;
    const rowsOnPage = Math.max(1, Math.ceil(page.length / config.cols));
    const cardW = config.cols === 1 ? contentW : (contentW - gap * (config.cols - 1)) / config.cols;
    // Keep the PDF composition compact and top-aligned like the live preview.
    // In particular, layout 2 should not stretch to fill the whole A4 page.
    const preferredRowH = safeLayout === '1' ? availableH : (safeLayout === '2' ? 205 : safeLayout === '3' ? 195 : 178);
    const minimumRowH = safeLayout === '2' ? 190 : safeLayout === '3' ? 180 : 168;
    const cardH = safeLayout === '1'
      ? availableH
      : Math.min(preferredRowH, Math.max(minimumRowH, (availableH - gap * (rowsOnPage - 1)) / rowsOnPage));
    page.forEach((product, idx) => {
      const row = Math.floor(idx / config.cols), col = idx % config.cols;
      const x = margin + col * (cardW + gap);
      const yCard = top - cardH - row * (cardH + gap);
      drawProduct(ops, product, pageIndex * config.perPage + idx, x, yCard, cardW, cardH, config.mode);
    });

    flyerStroke(ops, 0.86,0.83,0.78); flyerLine(ops, margin, margin + 14, W - margin, margin + 14, 0.7);
    flyerFill(ops, 0.45,0.43,0.40); flyerPdfText(ops, 'YHORS · MÁS QUE UN PRODUCTO', margin, margin + 3, 5.5, 1);
    if (contact) { flyerFill(ops, ar,ag,ab); flyerPdfText(ops, `Contacto: ${contactName || 'Equipo YHORS'}`, W / 2, margin + 3, 5.5, 2, 'center'); }
    flyerFill(ops, 0.45,0.43,0.40); flyerPdfText(ops, `${cleanProducts.length} producto${cleanProducts.length === 1 ? '' : 's'}`, W - margin, margin + 3, 5.5, 1, 'right');
    streams.push(ops.join('\n'));
  }

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${streams.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${streams.length} >>`
  ];
  streams.forEach((stream, i) => {
    const pageNo = 3 + i * 2, contentNo = pageNo + 1;
    objects.push(`PAGE_PLACEHOLDER_${pageNo}`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  const firstImageObject = objects.length + 1;
  const logoObject = logoJpeg ? firstImageObject + usedImages.length : null;
  const normalFontObject = logoJpeg ? logoObject + 1 : firstImageObject + usedImages.length;
  const boldFontObject = normalFontObject + 1;
  streams.forEach((_, i) => {
    const pageNo = 3 + i * 2, contentNo = pageNo + 1;
    const xobjects = usedImages.map((_, idx) => `/Im${idx + 1} ${firstImageObject + idx} 0 R`);
    if (logoJpeg) xobjects.push(`/Logo ${logoObject} 0 R`);
    objects[2 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /ProcSet [/PDF /Text /ImageC] /Font << /F1 ${normalFontObject} 0 R /F2 ${boldFontObject} 0 R >> /XObject << ${xobjects.join(' ')} >> >> /Contents ${contentNo} 0 R >>`;
  });
  usedImages.forEach(({ image }) => objects.push(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n${image.data.toString('latin1')}\nendstream`));
  if (logoJpeg && logoSize) objects.push(`<< /Type /XObject /Subtype /Image /Width ${logoSize.width} /Height ${logoSize.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpeg.length} >>\nstream\n${logoJpeg.toString('latin1')}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

app.post('/api/admin/flyers/pdf', requireOrdersAccess, async (req, res) => {
  try {
    const body = req.body || {};
    let rawIds = body.ids;
    if (typeof rawIds === 'string') {
      try { rawIds = JSON.parse(rawIds); } catch { rawIds = rawIds.split(',').map(x => x.trim()).filter(Boolean); }
    }
    const ids = Array.isArray(rawIds) ? [...new Set(rawIds.map(String))].slice(0, 80) : [];
    if (!ids.length) return res.status(400).json({ error: 'Selecciona al menos un producto.' });
    let parsedNotes = body.notes;
    if (typeof parsedNotes === 'string') {
      try { parsedNotes = JSON.parse(parsedNotes); } catch { parsedNotes = {}; }
    }
    const all = readProducts().map(normalizeProduct);
    const products = ids.map(id => all.find(p => String(p.id) === id)).filter(Boolean).map(p => ({
      id: p.id, name: p.name, description: p.description || '', category: p.category, brand: p.brand || '', productType: p.productType || '', sku: p.sku || '', salePrice: Number(p.salePrice ?? p.price ?? 0), stock: Number(p.stock || 0), image: p.image || '', images: Array.isArray(p.images) ? p.images.filter(Boolean) : []
    }));
    let imageData = body.imageData;
    if (typeof imageData === 'string') { try { imageData = JSON.parse(imageData); } catch { imageData = {}; } }
    if (imageData && typeof imageData === 'object') {
      products.forEach(product => {
        const data = imageData[String(product.id)];
        if (typeof data === 'string' && data.startsWith('data:image/')) product.imageData = data;
      });
    }
    if (!products.length) return res.status(404).json({ error: 'No se encontraron los productos seleccionados.' });
    const pdf = await buildFlyerPdf({
      products,
      title: String(body.title || 'Recién Llegados').slice(0, 90),
      subtitle: String(body.subtitle || '').slice(0, 140),
      description: String(body.description || '').slice(0, 280),
      layout: String(body.layout || '4'),
      orientation: body.orientation === 'landscape' ? 'landscape' : 'portrait',
      showPrices: body.showPrices !== false,
      theme: String(body.theme || 'none'),
      accent: String(body.accent || '#b58a43'),
      logo: body.logo !== 'none',
      contact: body.contact === true || body.contact === 'true' || body.contact === 'on',
      contactName: String(body.contactName || '').slice(0, 100),
      notes: parsedNotes && typeof parsedNotes === 'object' ? parsedNotes : {}
    });
    const safeTitle = String(body.title || 'flyer').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0, 60) || 'flyer';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="YHORS-Flyer-${safeTitle}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.end(pdf);
  } catch (error) {
    console.error('[YHORS] Error generando Flyer PDF:', error);
    res.status(500).json({ error: 'No se pudo generar el PDF del flyer.' });
  }
});

app.get('/robots.txt', (_, res) => {
  res.status(200)
    .set('Content-Type', 'text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=0, must-revalidate')
    .send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: ${ADMIN_PATH}\nDisallow: ${ADMIN_PATH}/\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (_, res) => {
  const products = readProducts().map(normalizeProduct).filter(product => product.published !== false);
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
  const products = readProducts().map(normalizeProduct).filter(product => product.published !== false);
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
  const products = readProducts().map(normalizeProduct).filter(product => product.published !== false);
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
  const products = readProducts().map(normalizeProduct).filter(product => product.published !== false);
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
    const product = readProducts().map(normalizeProduct).find(item => item.id === String(req.query.producto) && item.published !== false);
    if (product) return res.redirect(301, productUrl(product));
  }
  // Search result pages are useful to users but should not become an indexable URL for every query.
  if (req.query.buscar) {
    const query = stripText(req.query.buscar).slice(0, 80);
    const products = readProducts().map(normalizeProduct);
    return res.send(layout({ title: `Resultados para ${query} | YHORS-STORE`, description: `Resultados de búsqueda de ${query} en YHORS-STORE.`, canonical: `${SITE_URL}/`, robots: 'noindex,follow', json: [], body: `<main class="section"><div class="section-heading"><div><span class="eyebrow">Búsqueda YHORS</span><h1>Resultados para “${esc(query)}”</h1></div><p>Usa el buscador para explorar productos, marcas y categorías de YHORS-STORE.</p></div><p><a class="button" href="/">Volver al catálogo <span>→</span></a></p></main>` }));
  }
  const products = readProducts().map(normalizeProduct).filter(product => product.published !== false);
  const canonical = `${SITE_URL}/`;
  const organization = { '@context':'https://schema.org', '@type':'Organization', name:CORPORATE_NAME, url:`${SITE_URL}/yhors-corp`, brand:{ '@type':'Brand', name:'YHORS' }, subOrganization:{ '@type':'OnlineStore', name:SITE_NAME, url:canonical } };
  const website = { '@context':'https://schema.org', '@type':'WebSite', name:SITE_NAME, alternateName:['YHORS','YHORS-STORE'], url:canonical, potentialAction:{ '@type':'SearchAction', target:`${SITE_URL}/?buscar={search_term_string}`, 'query-input':'required name=search_term_string' } };
  return res.send(layout({ title:'YHORS-STORE | Tecnología, detalles, cosplay y más', description:'YHORS-STORE | Tecnología, moda, regalos, cosplays y experiencias. Una selección de calidad, diseñada para quienes buscan confianza, estilo y más.', canonical, json:[organization,website], body:homeSeoBody(products) }));
});

app.use(ADMIN_PATH, (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });

// YHORS Flyer: la vista previa se abre en una pestaña independiente y se
// imprime/guarda como PDF desde el navegador, sin exponer el catálogo fuera
// de una sesión autenticada.
app.get('/yhors/flyer', requireOrdersAccess, (_, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

  for (const fileName of ['products.json', 'storefront.json', 'classifications.json', 'orders.json', 'users.json', 'security.json', 'expenses.json', 'customers.json', 'purchases.json']) {
    const source = path.join(DATA_DIR, fileName);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backupDataDir, fileName));
  }
  copyDirectoryContents(UPLOADS_DIR, backupUploadsDir);

  const manifest = {
    app: 'YHORS-STORE',
    backupVersion: 3,
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
  for (const fileName of ['users.json', 'security.json', 'expenses.json', 'customers.json', 'purchases.json']) {
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
    for (const fileName of ['users.json', 'security.json', 'expenses.json', 'customers.json', 'purchases.json']) {
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

// V14.22 stock sync: state transitions are idempotent.

// V14.23 — stock sincronizado por estado.
// Estados que reservan/descuentan stock: Pendiente, Confirmado, Preparado, Enviado, Entregado.
// Cancelado devuelve exactamente las unidades que el pedido tenía reservadas.
// Todo pedido que no esté Cancelado mantiene su reserva de inventario.
// "Preparado" se comporta igual que "Pendiente": las unidades siguen reservadas
// y no se devuelven al inventario hasta que el pedido pase a Cancelado.
const STOCK_ACTIVE_ORDER_STATUSES = new Set([
  'pendiente', 'confirmado', 'preparado', 'enviado', 'entregado'
]);

function orderStatusUsesStock(status) {
  return STOCK_ACTIVE_ORDER_STATUSES.has(String(status || '').trim().toLocaleLowerCase('es-EC'));
}

function getPurchaseItems(order) {
  return (Array.isArray(order?.items) ? order.items : []).filter(item => {
    const mode = String(item?.purchaseMode || 'purchase').toLowerCase();
    return mode !== 'rental' && mode !== 'alquiler';
  });
}

function getStockDemand(order) {
  const demand = new Map();
  for (const item of getPurchaseItems(order)) {
    const productId = String(item.productId || '');
    const quantity = Number(item.quantity || 0);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) continue;
    demand.set(productId, (demand.get(productId) || 0) + quantity);
  }
  return demand;
}

function changeOrderStock(order, direction) {
  const demand = getStockDemand(order);
  if (!demand.size) return [];

  const products = readProducts().map(normalizeProduct);

  if (direction < 0) {
    for (const [productId, quantity] of demand.entries()) {
      const product = products.find(p => String(p.id) === productId);
      if (!product) throw new Error(`El producto del pedido ya no existe: ${productId}`);
      const current = Number(product.stock || 0);
      if (!Number.isInteger(current) || current < quantity) {
        throw new Error(`No hay suficiente stock para el producto “${product.name}”. Disponible: ${current}, solicitado: ${quantity}.`);
      }
    }
  }

  const movements = [];
  const updated = products.map(product => {
    const quantity = Number(demand.get(String(product.id)) || 0);
    if (!quantity) return product;
    const current = Number(product.stock || 0);
    const next = Math.max(0, current + (direction < 0 ? -quantity : quantity));
    movements.push({
      productId: product.id,
      sku: product.sku || '',
      name: product.name || '',
      quantity,
      direction: direction < 0 ? 'salida' : 'entrada',
      before: current,
      after: next,
      reason: direction < 0 ? 'Reserva de pedido' : 'Devolución de pedido'
    });
    return normalizeProduct({
      ...product,
      stock: next,
      updatedAt: new Date().toISOString()
    });
  });

  writeProducts(updated);
  return movements;
}

function reserveOrderStock(order) {
  return changeOrderStock(order, -1);
}

function restoreOrderPurchaseStock(order) {
  return changeOrderStock(order, 1);
}

function readSales() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(decryptOrder) : [];
  } catch { return []; }
}
function writeSales(sales) {
  maybeAutoBackup(); fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${SALES_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(sales.map(encryptOrder), null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, SALES_FILE);
}
function getSalesHistoryRecord(order, req) {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), orderId: order.id, orderNumber: order.orderNumber, notifiedAt: now, notifiedBy: getSession(req)?.accountId || null, status: String(order.status || 'Enviado'), assignedSellerId: order.assignedSellerId || null, assignedSellerName: order.assignedSellerName || null, createdAt: order.createdAt, updatedAt: now, customer: order.customer || {}, delivery: order.delivery || {}, shippingCost: Number(order.shippingCost ?? order.delivery?.cost ?? 0) || 0, subtotal: Number(order.subtotal || 0) || 0, total: Number(order.total || 0) || 0, items: Array.isArray(order.items) ? order.items : [], internalNote: order.internalNote || '' };
}

function readExpenses() {
  try {
    const parsed = JSON.parse(fs.readFileSync(EXPENSES_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeExpenses(expenses) {
  maybeAutoBackup();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${EXPENSES_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(expenses, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, EXPENSES_FILE);
}

function readFines() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FINES_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFines(fines) {
  maybeAutoBackup();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${FINES_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(fines, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, FINES_FILE);
}

function readOrders() {
  const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('El archivo de pedidos no contiene una lista válida.');
  return parsed.map(decryptOrder).map(order => ({
    ...order,
    assignedSellerId: typeof order.assignedSellerId === 'string' && order.assignedSellerId ? order.assignedSellerId : null
  }));
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

function isTechProduct(product = {}) {
  return String(product.category || '').toLowerCase() === 'tech';
}

function isImeiProduct(product = {}) {
  const type = String(product.productType || '').toLowerCase();
  const name = String(product.name || '').toLowerCase();
  return type.includes('celular') || type.includes('smartphone') || type.includes('mobile') || /\biphone\b|\bandroid\b|\btelefono\b|\bteléfono\b/.test(name);
}

function normalizeDeviceIdentifiers(requested, product, quantity, { required = false } = {}) {
  if (!isTechProduct(product)) return [];
  const source = Array.isArray(requested) ? requested : [];
  const identifiers = [];
  const imeiProduct = isImeiProduct(product);

  for (let index = 0; index < quantity; index += 1) {
    const raw = source[index] || {};
    const primary = cleanText(raw.primary ?? raw.imei ?? raw.serial, 50);
    const secondary = cleanText(raw.secondary ?? raw.imei2, 50);

    if (required && !primary) {
      throw new Error(`Registra ${imeiProduct ? `el IMEI 1` : `el número de serie`} de la unidad ${index + 1} de “${product.name}”.`);
    }
    if (primary) {
      if (imeiProduct && !/^\d{14,16}$/.test(primary)) {
        throw new Error(`El IMEI 1 de la unidad ${index + 1} de “${product.name}” debe contener entre 14 y 16 dígitos.`);
      }
      if (!imeiProduct && !/^[A-Za-z0-9._\-/ ]{3,50}$/.test(primary)) {
        throw new Error(`El número de serie de la unidad ${index + 1} de “${product.name}” no tiene un formato válido.`);
      }
    }
    if (secondary) {
      if (!imeiProduct || !/^\d{14,16}$/.test(secondary)) {
        throw new Error(`El IMEI 2 de la unidad ${index + 1} de “${product.name}” debe contener entre 14 y 16 dígitos.`);
      }
    }
    if (primary || secondary) identifiers.push({ unit: index + 1, type: imeiProduct ? 'imei' : 'serial', primary, secondary: secondary || null });
  }

  if (source.length > quantity) throw new Error(`La identificación de “${product.name}” no puede superar la cantidad solicitada.`);
  return identifiers;
}

function validateDeviceIdentifiersAcrossOrder(items) {
  const seen = new Map();
  for (const item of items) {
    for (const entry of Array.isArray(item.deviceIdentifiers) ? item.deviceIdentifiers : []) {
      for (const value of [entry.primary, entry.secondary]) {
        const normalized = String(value || '').trim().toUpperCase();
        if (!normalized) continue;
        if (seen.has(normalized)) {
          throw new Error(`La identificación “${value}” está repetida dentro de esta orden (${seen.get(normalized)}).`);
        }
        seen.set(normalized, item.name);
      }
    }
  }
}

function validateOrder(input, options = {}) {
  const requireDeviceIdentifiers = options.requireDeviceIdentifiers === true;
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
  if (!Object.prototype.hasOwnProperty.call(shippingCosts, deliveryMethod)) return { error: 'Selecciona una modalidad de entrega válida.' };
  if (!name || !phone || !cedula || !city) return { error: 'Completa nombre, teléfono, cédula/RUC y ciudad.' };
  if (!/^\d{10,13}$/.test(cedula)) return { error: 'La cédula/RUC debe tener entre 10 y 13 dígitos.' };
  if (deliveryMethod !== 'office' && !address) return { error: 'Ingresa la dirección para el envío seleccionado.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'El correo electrónico no es válido.' };
  if (mapsUrl && !/^https?:\/\//i.test(mapsUrl)) return { error: 'El enlace de Google Maps no es válido.' };

  const requestedItems = Array.isArray(input?.items) ? input.items : [];
  if (requestedItems.length < 1 || requestedItems.length > 50) return { error: 'El pedido no contiene productos válidos.' };

  const products = readProducts().map(normalizeProduct);
  const byId = new Map(products.map(product => [product.id, product]));
  const purchaseDemand = new Map();
  const items = [];

  for (const requested of requestedItems) {
    const product = byId.get(String(requested.productId || ''));
    const quantity = Math.max(1, Math.min(99, Number.parseInt(requested.quantity, 10) || 0));
    if (!product || !quantity) return { error: 'Uno de los productos del carrito ya no está disponible.' };

    const purchaseMode = requested.purchaseMode === 'rental' ? 'rental' : 'purchase';
    const rentalDays = purchaseMode === 'rental' ? Number.parseInt(requested.rentalDays, 10) : null;

    if (purchaseMode === 'rental' && (!Number.isInteger(rentalDays) || rentalDays < 1 || rentalDays > 10)) {
      return { error: `Selecciona entre 1 y 10 días de alquiler para “${product.name}”.` };
    }

    // Las compras descuentan stock. Los alquileres mantienen el stock porque
    // el sistema todavía no tiene un flujo de devolución de prendas.
    if (purchaseMode === 'purchase') {
      purchaseDemand.set(product.id, (purchaseDemand.get(product.id) || 0) + quantity);
    }

    const price = purchaseMode === 'rental' ? Number(product.rentalPrice) : Number(product.salePrice ?? product.price);
    if (!Number.isFinite(price) || price < 0 || (purchaseMode === 'rental' && product.rentalPrice === null)) {
      return { error: `El producto “${product.name}” no tiene un precio válido.` };
    }

    const durationMultiplier = purchaseMode === 'rental' ? rentalDays : 1;
    let deviceIdentifiers = [];
    if (purchaseMode === 'purchase' && isTechProduct(product)) {
      // La configuración de SERIES/IMEIS es la autoridad: si ADMIN desactivó
      // la identificación para este producto TEC, nunca se debe exigir desde
      // Generar orden, aunque la orden se valide con requireDeviceIdentifiers.
      const requiresIdentifier = product.requiresDeviceIdentifier !== false;
      try {
        deviceIdentifiers = normalizeDeviceIdentifiers(requested.deviceIdentifiers, product, quantity, {
          required: requireDeviceIdentifiers && requiresIdentifier
        });
      } catch (error) {
        return { error: error.message || `No se pudo validar la identificación de “${product.name}”.` };
      }
    }

    items.push({
      productId: product.id,
      sku: product.sku || '',
      name: product.name,
      category: product.category,
      purchaseMode,
      rentalDays,
      quantity,
      deviceIdentifiers,
      unitPrice: Math.round(price * 100) / 100,
      purchaseCost: purchaseMode === 'purchase' ? Math.round(Math.max(0, Number(product.purchasePrice) || 0) * 100) / 100 : 0,
      subtotal: Math.round(price * quantity * durationMultiplier * 100) / 100
    });
  }

  // Validación de stock en el servidor, agrupando líneas repetidas del mismo producto.
  for (const [productId, requestedQuantity] of purchaseDemand.entries()) {
    const product = byId.get(productId);
    const available = Number(product?.stock || 0);
    if (!Number.isInteger(available) || available < requestedQuantity) {
      return {
        error: `No hay suficiente stock de “${product?.name || 'este producto'}”.`
      };
    }
  }

  try { validateDeviceIdentifiersAcrossOrder(items); } catch (error) { return { error: error.message }; }

  const subtotal = Math.round(items.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100;
  const shippingCost = shippingCosts[deliveryMethod];
  const total = Math.round((subtotal + shippingCost) * 100) / 100;

  return {
    order: {
      customer: { name, phone, cedula, email, city, address: deliveryMethod === 'office' ? '' : address, mapsUrl, notes },
      delivery: { method: deliveryMethod, label: deliveryLabels[deliveryMethod], cost: shippingCost },
      items, subtotal, shippingCost, total
    },
    stockProducts: products,
    purchaseDemand
  };
}

function applyPurchaseStock(products, purchaseDemand) {
  const updated = products.map(product => {
    const normalized = normalizeProduct(product);
    const demand = Number(purchaseDemand.get(normalized.id) || 0);
    if (!demand) return normalized;
    const currentStock = Number(normalized.stock || 0);
    if (!Number.isInteger(currentStock) || currentStock < demand) {
      throw new Error(`El stock de “${normalized.name}” cambió mientras se procesaba el pedido. Intenta nuevamente.`);
    }
    return normalizeProduct({
      ...normalized,
      stock: currentStock - demand,
      updatedAt: new Date().toISOString()
    });
  });
  return updated;
}

function makeSession(user, role, accountId = '', metadata = {}) {
  sessionCleanup();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = {
    id: token,
    user,
    role,
    accountId: String(accountId || ''),
    ip: String(metadata.ip || '').slice(0, 120) || null,
    userAgent: String(metadata.userAgent || '').slice(0, 300) || null,
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
    if (session.expiresAt <= now) {
      sessions.delete(token);
      auditLog(null, 'Sesión expirada', 'Seguridad', {
        username: session.user,
        accountId: session.accountId,
        role: session.role,
        reason: 'Tiempo de sesión agotado'
      }, 'success');
    }
  }
}
setInterval(sessionCleanup, 10 * 60 * 1000).unref();

function hasValidSession(req) { return Boolean(getSession(req)); }

function requireLogin(req, res, next) { const session = getSession(req); if (!session) return res.status(401).json({ error: 'No autorizado.' }); req.yhorsSession = session; next(); }

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });
  if (!isAdmin(session.role)) return res.status(403).json({ error: 'Se requiere una cuenta de administrador.' });
  return next();
}

function requireOrdersAccess(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });
  if (!['admin', 'store_manager', 'vendedor', 'orders'].includes(normalizeRole(session.role))) {
    return res.status(403).json({ error: 'Esta cuenta no tiene acceso a Gestión de pedidos.' });
  }
  return next();
}
function requireStoreManager(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });
  if (!isStoreManager(session.role)) return res.status(403).json({ error: 'Solo el Jefe de tienda puede realizar esta acción.' });
  return next();
}
function requireStoreManagerOrAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });
  if (!isStoreManager(session.role) && !isAdmin(session.role)) return res.status(403).json({ error: 'Solo el Jefe de tienda o un administrador puede eliminar pedidos.' });
  return next();
}

function requireCatalogRead(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autorizado.' });
  if (!isAdmin(session.role)) return res.status(403).json({ error: 'Solo el administrador puede consultar el catálogo administrativo.' });
  return next();
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// Descripciones de producto: permitimos únicamente formato visual seguro.
// No se aceptan atributos, scripts, enlaces ni HTML arbitrario.
function sanitizeDescriptionHtml(value, maxLength = 2000) {
  if (typeof value !== 'string') return '';
  let html = value.replace(/\r/g, '').trim();
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|svg|math)[^>]*\/?>/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/javascript\s*:/gi, '');
  html = html.replace(/<\s*([^>]+)>/g, (full, inside) => {
    const match = String(inside).match(/^\s*\/?\s*([a-z0-9]+)/i);
    if (!match) return '';
    const tag = match[1].toLowerCase();
    return ['b','strong','i','em','u','br','p','div','h2','h3','ul','ol','li'].includes(tag) ? `<${inside.replace(/\s+(?:style|class|id|title|href|src|target|rel)\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)/gi,'')}>` : '';
  });
  return html.slice(0, maxLength);
}


function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

async function sendOrderConfirmationEmail(order) {
  const email = order?.customer?.email;
  if (!email) return { sent: false, reason: 'no-customer-email' };

  const itemsHtml = (order.items || []).map(item => {
    const rentalText = item.purchaseMode === 'rental' ? ` · Alquiler · ${Number(item.rentalDays || 1)} día${Number(item.rentalDays || 1) === 1 ? '' : 's'} · $${Number(item.unitPrice || 0).toFixed(2)}/día` : '';
    const identifiers = (item.deviceIdentifiers || []).map(entry => `${entry.type === 'imei' ? 'IMEI' : 'Serie'} ${entry.unit}: ${entry.primary}${entry.secondary ? ` / ${entry.secondary}` : ''}`).join(' · ');
    return `<tr><td style="padding:8px 0">${escapeEmailHtml(item.quantity)}× ${escapeEmailHtml(item.name)}<br><small>SKU: ${escapeEmailHtml(item.sku || '—')}${escapeEmailHtml(rentalText)}${identifiers ? `<br>Identificación: ${escapeEmailHtml(identifiers)}` : ''}</small></td><td style="padding:8px 0;text-align:right">$${Number(item.subtotal || 0).toFixed(2)}</td></tr>`;
  }).join('');
  const mapsHtml = order.customer.mapsUrl ? `<p><strong>Ubicación:</strong> <a href="${escapeEmailHtml(order.customer.mapsUrl)}">Abrir en Google Maps</a></p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#222">
    <h1 style="margin-bottom:4px">YHORS STORE</h1>
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
    <p><strong>Celular:</strong> ${escapeEmailHtml(order.customer.phone || '—')}</p>
    <p><strong>Correo:</strong> ${escapeEmailHtml(order.customer.email || '—')}</p>
    <p><strong>Ciudad:</strong> ${escapeEmailHtml(order.customer.city || '—')}</p>
    <p><strong>Dirección:</strong> ${escapeEmailHtml(order.customer.address || 'Retiro en oficina')}</p>
    ${mapsHtml}
    ${order.customer.notes ? `<p><strong>Nota:</strong> ${escapeEmailHtml(order.customer.notes)}</p>` : ''}
    <p style="color:#777">Te contactaremos para continuar con la coordinación de tu pedido.</p>
  </div>`;
  const text = `YHORS STORE · Pedido #${order.orderNumber}\n\nTotal: $${Number(order.total || 0).toFixed(2)}\nEntrega: ${order.delivery.label}\nCédula / RUC: ${order.customer.cedula || '—'}\nCelular: ${order.customer.phone || '—'}\nCorreo: ${order.customer.email || '—'}\nCiudad: ${order.customer.city || '—'}\nDirección: ${order.customer.address || 'Retiro en oficina'}${order.customer.mapsUrl ? `\nGoogle Maps: ${order.customer.mapsUrl}` : ''}`;

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
  const description = sanitizeDescriptionHtml(input.description, 2000);
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
    purchasePrice: Number.isFinite(Number(current.purchasePrice)) ? Math.max(0, Math.round(Number(current.purchasePrice) * 100) / 100) : 0,
    stock: Number.isInteger(Number(current.stock)) && Number(current.stock) >= 0 ? Number(current.stock) : 0,
    rentalPrice: category === 'cosplay' ? Math.round(rentalPrice * 100) / 100 : null,
    price: Math.round(salePrice * 100) / 100,
    image: finalImages[0] || '', images: finalImages,
    published: input.published === undefined ? (current.published !== false) : (input.published === true || input.published === 'true'),
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
  const purchasePrice = Number(product.purchasePrice);
  const stock = Number(product.stock);
  return {
    ...product,
    sku: normalizeSku(product.sku) || makeUniqueSku('', product, [], product.id),
    image: product.image || images[0] || '',
    images,
    purchasePrice: Number.isFinite(purchasePrice) && purchasePrice >= 0 ? Math.round(purchasePrice * 100) / 100 : 0,
    salePrice: Number.isFinite(Number(product.salePrice ?? product.price)) && Number(product.salePrice ?? product.price) >= 0 ? Math.round(Number(product.salePrice ?? product.price) * 100) / 100 : 0,
    price: Number.isFinite(Number(product.salePrice ?? product.price)) && Number(product.salePrice ?? product.price) >= 0 ? Math.round(Number(product.salePrice ?? product.price) * 100) / 100 : 0,
    stock: Number.isInteger(stock) && stock >= 0 ? stock : 0,
    // Para productos TEC existentes conservamos el comportamiento anterior: solicitar identificación.
    // El Gestor de Series/IMEIS puede desactivarlo individualmente.
    requiresDeviceIdentifier: isTechProduct(product)
      ? (product.requiresDeviceIdentifier === undefined ? true : product.requiresDeviceIdentifier === true)
      : false,
    published: product.published !== false
  };
}

function publicProduct(product) {
  const normalized = normalizeProduct(product);
  const { stock, purchasePrice, published, ...safe } = normalized;
  return { ...safe, inStock: stock > 0 };
}

app.get('/api/products', (_, res) => res.json(readProducts().map(normalizeProduct).filter(product => product.published !== false).map(publicProduct)));
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
  if (!challenge?.options) {
    auditLog(req, 'Passkey fallida', 'Seguridad', { reason: 'Desafío expirado' }, 'failure');
    return res.status(401).json({ error: 'El desafío Passkey expiró. Inténtalo nuevamente.' });
  }
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
  if (!account || account.active === false || !credential || !passkeyAllowed(account.id)) {
    auditLog(req, 'Passkey fallida', 'Seguridad', { username: account?.username || null, accountId: account?.id || null, reason: 'Passkey no reconocida o no autorizada' }, 'failure');
    return res.status(401).json({ error: 'Passkey no reconocida o no autorizada.' });
  }
  try {
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challenge.options.challenge,
      expectedOrigin: WEBAUTHN_ORIGIN,
      expectedRPID: WEBAUTHN_RP_ID,
      requireUserVerification: true,
      credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')), counter: credential.counter || 0, transports: credential.transports || [] }
    });
    if (!verification.verified) {
      auditLog(req, 'Passkey fallida', 'Seguridad', { username: account.username, accountId: account.id, role: account.role, reason: 'Verificación no válida' }, 'failure');
      return res.status(401).json({ error: 'No se pudo verificar la Passkey.' });
    }
    const store = readPasskeyStore();
    const list = store.passkeys[String(account.id)] || [];
    const index = list.findIndex(item => item.id === credential.id);
    if (index >= 0) { list[index].counter = verification.authenticationInfo.newCounter; list[index].lastUsedAt = new Date().toISOString(); store.passkeys[String(account.id)] = list; writePasskeyStore(store); }
    clearFailedAttempts(clientIp(req), account.username);
    auditLog(req, 'Inicio de sesión con Passkey', 'Seguridad', { username: account.username, accountId: account.id, role: account.role });
    const session = makeSession(account.username, account.role, account.id, { ip: clientIp(req), userAgent: req.get('user-agent') });
    setSessionCookie(res, session);
    return res.json({ ok: true, role: session.role, username: account.username, name: account.name, expiresAt: session.expiresAt });
  } catch (error) { auditLog(req, 'Passkey fallida', 'Seguridad', { username: account?.username || null, accountId: account?.id || null, reason: 'Error de verificación' }, 'failure'); return res.status(401).json({ error: 'No se pudo verificar la Passkey.' }); }
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
  store.passkeys[session.accountId] = list.filter(item => item.id !== req.params.id);
  writePasskeyStore(store);
  auditLog(req, 'Passkey eliminada', 'Seguridad', { accountId: session.accountId, username: session.user, role: session.role, remaining: store.passkeys[session.accountId].length });
  return res.json({ ok: true, passkeys: publicPasskeys(session.accountId) });
});

app.post('/api/admin/users/:id/passkeys/policy', requireAdmin, (req, res) => {
  const users = readUsers(); const user = users.find(item => item.id === req.params.id); if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const enabled = req.body?.enabled !== false;
  const store = readPasskeyStore(); store.passkeyPolicy[user.id] = enabled; writePasskeyStore(store);
  auditLog(req, enabled ? 'Passkey habilitada' : 'Passkey bloqueada', 'Seguridad', {
    accountId: user.id, username: user.username, role: user.role, enabled
  });
  return res.json(publicUser(user));
});

app.delete('/api/admin/users/:id/passkeys', requireAdmin, (req, res) => {
  const users = readUsers(); const user = users.find(item => item.id === req.params.id); if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const count = accountPasskeys(user.id).length;
  const store = readPasskeyStore(); store.passkeys[user.id] = []; writePasskeyStore(store); destroySessionsForAccount(user.id);
  auditLog(req, 'Passkeys revocadas', 'Seguridad', {
    accountId: user.id, username: user.username, role: user.role, credentialsRevoked: count
  });
  return res.json(publicUser(user));
});


app.get('/api/admin/security/overview', requireAdmin, (req, res) => {
  const users = readUsers();
  const security = readSecurity();
  const now = Date.now();
  const sessionsByAccount = new Map();
  for (const session of sessions.values()) {
    if (session.expiresAt <= now) continue;
    const key = String(session.accountId || '');
    sessionsByAccount.set(key, (sessionsByAccount.get(key) || 0) + 1);
  }
  const rows = users.map(user => {
    const protection = loginProtectionStatus(user.id);
    const passkeys = accountPasskeys(user.id);
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      role: normalizeRole(user.role),
      active: user.active !== false,
      passkeyAllowed: passkeyAllowed(user.id),
      passkeyCount: passkeys.length,
      lastPasskeyUsedAt: passkeys.reduce((latest, item) => item.lastUsedAt && (!latest || item.lastUsedAt > latest) ? item.lastUsedAt : latest, null),
      locked: protection.locked,
      permanentLock: protection.permanent,
      lockRemainingSeconds: protection.remainingSeconds,
      failedAttempts: protection.failures,
      lockStage: protection.stage,
      activeSessions: sessionsByAccount.get(String(user.id)) || 0
    };
  });
  const auditEntries = readAudit().filter(entry => entry.module === 'Seguridad');
  return res.json({
    version: 'V15.4',
    generatedAt: new Date().toISOString(),
    totals: {
      users: users.length,
      activeUsers: users.filter(user => user.active !== false).length,
      admins: users.filter(user => isAdmin(user.role) && user.active !== false).length,
      passkeys: rows.reduce((sum, row) => sum + row.passkeyCount, 0),
      lockedUsers: rows.filter(row => row.locked).length,
      activeSessions: rows.reduce((sum, row) => sum + row.activeSessions, 0),
      securityEvents: auditEntries.length
    },
    users: rows
  });
});

app.post('/api/admin/security/users/:id/reset-lock', requireAdmin, (req, res) => {
  const user = readUsers().find(item => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const before = loginProtectionRecord(user.id);
  clearLoginProtection(user.id);
  auditLog(req, 'Bloqueo restablecido', 'Seguridad', {
    accountId: user.id,
    username: user.username,
    role: user.role,
    previous: { failures: before.failures, stage: before.stage, permanentlyLocked: before.permanentlyLocked }
  });
  return res.json({ ok: true, username: user.username });
});

app.post('/api/admin/security/users/:id/revoke-sessions', requireAdmin, (req, res) => {
  const user = readUsers().find(item => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  let revoked = 0;
  const target = String(user.id);
  for (const [token, session] of sessions) {
    if (String(session.accountId || '') === target) {
      sessions.delete(token);
      revoked += 1;
    }
  }
  auditLog(req, 'Sesiones revocadas', 'Seguridad', {
    accountId: user.id,
    username: user.username,
    role: user.role,
    sessionsRevoked: revoked
  });
  return res.json({ ok: true, sessionsRevoked: revoked });
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

  if (!username || !password) {
    auditLog(req, 'Inicio de sesión fallido', 'Seguridad', { username, reason: 'Credenciales incompletas' }, 'failure');
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  const key = rateLimitKey(ip, username);
  const ipKey = `login-ip:${ip}`;
  const ipEntry = loginAttempts.get(ipKey);
  // El bloqueo progresivo por cuenta controla los 4 intentos + escalamiento.
  // El límite por IP sigue siendo una barrera adicional contra ataques distribuidos desde un mismo origen.
  if (isRateLimited(ipKey, LOGIN_IP_LIMIT_MAX_ATTEMPTS)) {
    auditLog(req, 'Límite de intentos activado', 'Seguridad', { username, reason: 'Límite por IP alcanzado' }, 'failure');
    return rateLimitResponse(res, ipEntry.resetAt);
  }

  const account = findUserByUsername(username);
  if (account) {
    const protection = loginProtectionStatus(account.id);
    if (protection.locked) {
      if (protection.permanent) {
        auditLog(req, 'Acceso bloqueado', 'Seguridad', { username: account.username, accountId: account.id, role: account.role, permanent: true, stage: protection.stage }, 'failure');
        return res.status(423).json({ error: 'Tu acceso está bloqueado. Indica a tu proveedor que restablezca la contraseña para recuperar el acceso.', permanentLock: true });
      }
      auditLog(req, 'Acceso bloqueado', 'Seguridad', { username: account.username, accountId: account.id, role: account.role, permanent: false, remainingSeconds: protection.remainingSeconds, stage: protection.stage }, 'failure');
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
      if (protection.permanent) {
        auditLog(req, 'Cuenta bloqueada permanentemente', 'Seguridad', { username: account.username, accountId: account.id, role: account.role, stage: protection.stage, failures: protection.failures }, 'failure');
        return res.status(423).json({ error: 'Tu acceso ha sido bloqueado definitivamente por seguridad. Indica a tu proveedor que restablezca la contraseña.', permanentLock: true });
      }
      if (protection.locked) {
        const minutes = Math.ceil(protection.remainingSeconds / 60);
        auditLog(req, 'Cuenta bloqueada temporalmente', 'Seguridad', { username: account.username, accountId: account.id, role: account.role, lockoutSeconds: protection.remainingSeconds, lockoutStage: protection.stage }, 'failure');
        return res.status(423).json({ error: `Demasiados intentos. Tu acceso se bloqueará durante ${minutes} minutos.`, lockoutSeconds: protection.remainingSeconds, lockoutStage: protection.stage });
      }
      auditLog(req, 'Inicio de sesión fallido', 'Seguridad', { username, accountId: account.id, role: account.role, attemptsRemaining: protection.attemptsRemaining, attemptsUsed: protection.failures }, 'failure');
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.', attemptsRemaining: protection.attemptsRemaining, attemptsUsed: protection.failures, attemptsLimit: ACCOUNT_LOGIN_ATTEMPTS_BEFORE_LOCK });
    }
    auditLog(req, 'Inicio de sesión fallido', 'Seguridad', { username, reason: 'Credenciales incorrectas' }, 'failure');
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  clearFailedAttempts(ip, username);
  clearLoginProtection(account.id);
  auditLog(req, 'Inicio de sesión exitoso', 'Seguridad', { username: account.username, accountId: account.id, role: account.role });
  const session = makeSession(account.username, account.role, account.id, { ip, userAgent: req.get('user-agent') });
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
    expiresAt: session.expiresAt
  });
});

app.post('/api/logout', (req, res) => {
  auditLog(req, 'Cierre de sesión', 'Seguridad');
  destroySession(req);
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
    assignedSellerId: null,
    // El stock se descuenta al crear el pedido, por lo que dejamos una marca
    // explícita para que una futura eliminación pueda devolverlo de forma segura.
    stockReservedAt: new Date().toISOString(),
    ...result.order
  };

  // Descontamos stock únicamente para compras y guardamos ambas escrituras
  // con rollback del catálogo si el pedido no pudiera persistirse.
  const previousProducts = result.stockProducts.map(product => ({ ...product }));
  let updatedProducts;
  try {
    updatedProducts = applyPurchaseStock(previousProducts, result.purchaseDemand);
    writeProducts(updatedProducts);
    orders.unshift(order);
    try {
      writeOrders(orders);
    } catch (orderError) {
      try { writeProducts(previousProducts); } catch (rollbackError) {
        console.error('[YHORS] Falló el rollback del inventario:', rollbackError.message);
      }
      throw orderError;
    }
  } catch (error) {
    console.error('[YHORS] No se pudo registrar el pedido:', error.message);
    return res.status(500).json({ error: 'No se pudo registrar el pedido. No se realizó el descuento de inventario.' });
  }

  upsertCustomerFromOrder(order, req);

  auditLog(req, 'Pedido creado', 'Pedidos', {
    orderId: order.id,
    orderNumber: order.orderNumber,
    source: 'public',
    order: auditOrderSnapshot(order),
    inventory: {
      synchronized: true,
      movements: auditStockMovementDiff(previousProducts, updatedProducts, 'Reserva de pedido')
    }
  });
  try { await sendOrderConfirmationEmail(order); } catch (emailError) { console.error('[YHORS] No se pudo enviar la confirmación por correo:', emailError.message); }
  return res.status(201).json({ orderNumber: order.orderNumber, status: order.status, total: order.total });
});

app.post('/api/admin/generar-orden', requireOrdersAccess, async (req, res) => {
  const session = getSession(req);
  const body = req.body || {};
  let selectedCustomer = null;
  if (body.customerId) {
    selectedCustomer = readCustomers().find(item => String(item.id) === String(body.customerId));
    if (!selectedCustomer) return res.status(404).json({ error: 'El cliente seleccionado ya no existe en el fichero.' });
    // El expediente guardado es la fuente de verdad: así una orden nunca crea
    // una segunda ficha ni guarda datos escritos de forma distinta para el mismo cliente.
    body.customer = { ...selectedCustomer, notes: body.customer?.notes ?? selectedCustomer.notes ?? '' };
  }
  const result = validateOrder(body, { requireDeviceIdentifiers: true });
  if (result.error) return res.status(400).json(result);

  const hasSellerSelection = Object.prototype.hasOwnProperty.call(req.body || {}, 'assignedSellerId');
  const requestedSellerId = hasSellerSelection && req.body.assignedSellerId !== null && req.body.assignedSellerId !== ''
    ? String(req.body.assignedSellerId)
    : null;
  let assignedSellerId = null;
  if (requestedSellerId) {
    const seller = readUsers().find(user => user.id === requestedSellerId && user.active !== false && isSellerRole(user.role));
    if (!seller) return res.status(400).json({ error: 'El vendedor seleccionado no es válido o no está activo.' });
    assignedSellerId = seller.id;
  } else if (isSellerRole(session.role) && !hasSellerSelection) {
    // Compatibilidad: si una petición antigua no envía el campo, se mantiene
    // la asignación automática al vendedor que está creando la orden.
    assignedSellerId = session.accountId || null;
  }

  const orders = readOrders();
  const order = { id: crypto.randomUUID(), orderNumber: nextOrderNumber(orders), status: 'Pendiente', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assignedSellerId, source: 'admin_generated', stockReservedAt: new Date().toISOString(), ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}), ...result.order };
  const previousProducts = result.stockProducts.map(product => ({ ...product }));
  let updatedProducts;
  try {
    updatedProducts = applyPurchaseStock(previousProducts, result.purchaseDemand);
    writeProducts(updatedProducts);
    orders.unshift(order);
    try { writeOrders(orders); } catch (orderError) { try { writeProducts(previousProducts); } catch (rollbackError) { console.error('[YHORS] Falló el rollback del inventario:', rollbackError.message); } throw orderError; }
  } catch (error) {
    console.error('[YHORS] No se pudo generar la orden desde administración:', error.message);
    return res.status(500).json({ error: 'No se pudo generar la orden. No se realizó el descuento de inventario.' });
  }
  upsertCustomerFromOrder(order, req);

  auditLog(req, 'Pedido creado', 'Pedidos', {
    orderId: order.id,
    orderNumber: order.orderNumber,
    source: 'admin_generated',
    order: auditOrderSnapshot(order),
    inventory: {
      synchronized: true,
      movements: auditStockMovementDiff(previousProducts, updatedProducts, 'Reserva de pedido')
    }
  });
  try { await sendOrderConfirmationEmail(order); } catch (emailError) { console.error('[YHORS] No se pudo enviar la confirmación por correo:', emailError.message); }
  return res.status(201).json({ orderId: order.id, orderNumber: order.orderNumber, status: order.status, total: order.total, assignedSellerId });
});

app.get('/api/admin/session', (req, res) => { const session = getSession(req); const account = session ? readUsers().find(user => user.id === session.accountId || user.username === session.user) : null; return res.json({ authenticated: Boolean(session), username: session?.user || null, name: account?.name || null, role: session?.role || null, accountId: session?.accountId || null }); });
app.get('/api/admin/security', requireAdmin, (_, res) => res.json({
  dataEncryption: 'AES-256-GCM',
  ordersEncryptedAtRest: true,
  keySource: 'YHORS_DATA_KEY environment variable',
  version: 'V15.4',
  auditSecurity: true,
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
  auditLog(req, 'Usuario creado', 'Usuarios', { accountId: user.id, username: user.username, role: user.role, active: user.active });
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
  auditLog(req, 'Usuario actualizado', 'Usuarios', {
    accountId: updated.id,
    username: updated.username,
    changes: auditDiff(
      { name: current.name, username: current.username, role: current.role, active: current.active, passwordChanged: false },
      { name: updated.name, username: updated.username, role: updated.role, active: updated.active, passwordChanged: Boolean(result.user.password) },
      ['name','username','role','active','passwordChanged']
    )
  });
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
  auditLog(req, 'Usuario eliminado', 'Usuarios', { accountId: target.id, username: target.username, role: target.role });
  if (isSellerRole(target.role)) {
    const orders = readOrders();
    const changed = orders.map(order => order.assignedSellerId === target.id
      ? { ...order, assignedSellerId: null, updatedAt: new Date().toISOString() }
      : order);
    if (JSON.stringify(changed) !== JSON.stringify(orders)) writeOrders(changed);
  }
  destroySessionsForAccount(target.id);
  return res.status(204).end();
});


function decorateOrderAssignment(order) {
  const seller = order?.assignedSellerId
    ? readUsers().find(user => user.id === order.assignedSellerId)
    : null;
  return {
    ...order,
    assignedSellerName: seller?.name || order?.assignedSellerName || null
  };
}

app.get('/api/admin/order-sellers', requireOrdersAccess, (_, res) => {
  const sellers = readUsers()
    .filter(user => user.active !== false && isSellerRole(user.role))
    .map(user => ({ id: user.id, name: user.name, username: user.username, role: 'vendedor' }));
  return res.json(sellers);
});


app.get('/api/admin/resumen-financiero', requireAdmin, (req, res) => {
  const orders = readOrders();
  const products = readProducts().map(normalizeProduct);
  const users = readUsers();
  const sellerMap = new Map(users.filter(user => isSellerRole(user.role)).map(user => [String(user.id), user]));
  const expenses = readExpenses();
  const fines = readFines();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : '';
  const localDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  };
  const activeStatuses = new Set(['Pendiente', 'Confirmado', 'Preparado', 'Enviado', 'Entregado']);
  const productMap = new Map(products.map(product => [String(product.id), product]));
  const filteredOrders = orders.filter(order => {
    const date = localDate(order.createdAt);
    if (!date || (from && date < from) || (to && date > to)) return false;
    return activeStatuses.has(String(order.status || 'Pendiente'));
  });
  const filteredExpenses = expenses.filter(expense => {
    const date = String(expense.date || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && (!from || date >= from) && (!to || date <= to);
  });
  const round = value => Math.round(Number(value || 0) * 100) / 100;
  let sales = 0;
  let purchases = 0;
  let shipping = 0;
  const salesBySeller = new Map();

  for (const order of filteredOrders) {
    sales += Number(order.total || 0);
    shipping += Number(order.shippingCost ?? order.delivery?.cost ?? 0);
    for (const item of Array.isArray(order.items) ? order.items : []) {
      if (item.purchaseMode !== 'purchase') continue;
      const fallbackProduct = productMap.get(String(item.productId || ''));
      const purchaseCost = Number.isFinite(Number(item.purchaseCost)) ? Number(item.purchaseCost) : Number(fallbackProduct?.purchasePrice || 0);
      purchases += Math.max(0, purchaseCost) * Math.max(0, Number(item.quantity || 0));
    }
    const sellerId = order.assignedSellerId || 'unassigned';
    const sellerName = order.assignedSellerName || sellerMap.get(String(order.assignedSellerId || ''))?.name || (sellerId === 'unassigned' ? 'Sin vendedor' : 'Vendedor');
    const seller = salesBySeller.get(sellerId) || { sellerId, sellerName, total: 0, orders: 0 };
    seller.total += Number(order.total || 0);
    seller.orders += 1;
    salesBySeller.set(sellerId, seller);
  }

  const manualExpenses = filteredExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const totalExpenses = shipping + manualExpenses;
  const totalSales = round(sales);
  const totalPurchases = round(purchases);
  const totalShipping = round(shipping);
  const totalManualExpenses = round(manualExpenses);
  const totalExpensesRounded = round(totalExpenses);
  const profit = round(totalSales - totalPurchases - totalExpensesRounded);
  const margin = totalSales > 0 ? round((profit / totalSales) * 100) : 0;
  const expenseRows = filteredExpenses
    .map(expense => ({ ...expense, amount: round(expense.amount) }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  return res.json({
    filters: { from, to },
    totals: { sales: totalSales, purchases: totalPurchases, shipping: totalShipping, manualExpenses: totalManualExpenses, expenses: totalExpensesRounded, profit, margin, orderCount: filteredOrders.length },
    expenses: expenseRows,
    salesBySeller: [...salesBySeller.values()].sort((a, b) => b.total - a.total).map(row => ({ ...row, total: round(row.total) }))
  });
});


// V14.26 · Reporte PDF del Resumen Financiero.
// Se genera en cada solicitud con los datos actuales y sin cache para que
// el botón siempre entregue una versión actualizada del período seleccionado.
function buildFinancialReportPdf(report) {
  const W = 595, H = 842, margin = 38, right = W - margin;
  const normalFont = 1, boldFont = 2;
  // Mismo logo oficial utilizado en los PDF de órdenes de YHORS.
  const logoPath = path.join(__dirname, 'public', 'assets', 'yhors-logo-pdf.jpg');
  let logoJpeg = null;
  try { logoJpeg = fs.readFileSync(logoPath); } catch { logoJpeg = null; }
  const logoWidth = 150;
  const logoHeight = 33;
  const pdfEscapeLocal = value => String(value ?? '')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2022/g, '-')
    .replace(/[^\x20-\xFF]/g, '?');
  const money = value => `$${Number(value || 0).toFixed(2)}`;
  const wrap = (text, maxChars) => {
    const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const out = []; let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length > maxChars) { out.push(line); line = word; }
      else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  const drawText = (ops, text, x, y, size = 9, font = normalFont, align = 'left') => {
    const raw = String(text ?? '');
    const approx = raw.length * size * 0.52;
    let tx = x;
    if (align === 'right') tx = x - approx;
    if (align === 'center') tx = x - approx / 2;
    ops.push(`BT /F${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscapeLocal(raw)}) Tj ET`);
  };
  const line = (ops,x1,y1,x2,y2,width=.7) => ops.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (ops,x,y,w,h,width=.7) => ops.push(`${width} w ${x} ${y} ${w} ${h} re S`);
  const fill = (ops,x,y,w,h,r=.96,g=.95,b=.91) => ops.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f 0 0 0 rg`);
  const pages = [];
  let ops = [], y = H - margin;
  const newPage = () => {
    if (ops.length) pages.push(ops.join('\n'));
    ops = []; y = H - margin;
    if (logoJpeg) {
      ops.push(`q ${logoWidth} 0 0 ${logoHeight} ${margin} ${y - logoHeight + 4} cm /Im1 Do Q`);
    } else {
      drawText(ops, 'YHORS', margin, y - 4, 20, boldFont);
    }
    // El título se desplaza 10 puntos hacia la izquierda; no afecta al logo.
    drawText(ops, 'REPORTE FINANCIERO', right - 10, y - 2, 15, boldFont, 'right');
    y -= 32;
    line(ops, margin, y, right, y, 1);
    y -= 18;
  };

  y -= 2;


  newPage();

  const title = 'RESUMEN FINANCIERO YHORS';
  drawText(ops, title, margin, y, 16, boldFont);
  y -= 18;
  drawText(ops, `Periodo: ${report.from || 'Todo'} → ${report.to || 'Todo'}`, margin, y, 9);
  drawText(ops, `Generado: ${report.generatedAt}`, right, y, 8, normalFont, 'right');
  y -= 24;

  const metrics = [
    ['VENTAS TOTALES', money(report.totals.sales)],
    ['TOTAL COMPRAS', money(report.totals.purchases)],
    ['GANANCIAS NETAS', money(report.totals.profit)],
    ['TOTAL GASTOS', money(report.totals.expenses)]
  ];
  const gap = 10, mw = (right - margin - gap * 3) / 4;
  metrics.forEach((m,i) => {
    const x = margin + i * (mw + gap);
    fill(ops,x,y-55,mw,55,0.97,0.96,0.93);
    rect(ops,x,y-55,mw,55,.7);
    drawText(ops,m[0],x+8,y-16,6.5,boldFont);
    drawText(ops,m[1],x+8,y-37,11,boldFont);
  });
  y -= 75;
  drawText(ops, `Ventas Totales: ${Number(report.totals.orderCount || 0)}   ·   Margen: ${Number(report.totals.margin || 0).toFixed(2)}%`, margin, y, 8);
  y -= 22;

  const section = (label) => {
    if (y < 95) newPage();
    drawText(ops,label,margin,y,10,boldFont);
    y -= 10;
    line(ops,margin,y,right,y,.8);
    y -= 16;
  };

  section('VENTAS POR VENDEDOR');
  y -= 5;
  drawText(ops,'VENDEDOR',margin,y,7,boldFont);
  drawText(ops,'VENTAS TOTALES',right-150,y,7,boldFont,'right');
  drawText(ops,'TOTAL VENDIDO',right,y,7,boldFont,'right');
  y -= 10;
  for (const row of (report.salesBySeller || [])) {
    if (y < 55) newPage(), section('VENTAS POR VENDEDOR (CONTINUACIÓN)');
    drawText(ops,wrap(row.sellerName || 'Sin vendedor',38)[0],margin,y,8);
    drawText(ops,String(row.orders || 0),right-150,y,8,normalFont,'right');
    drawText(ops,money(row.total),right,y,8,boldFont,'right');
    y -= 16; line(ops,margin,y,right,y,.35); y -= 7;
  }

  y -= 10;

  section('GASTOS DEL PERÍODO');
  drawText(ops,'FECHA',margin,y,7,boldFont);
  drawText(ops,'CONCEPTO / DETALLE',margin+75,y,7,boldFont);
  drawText(ops,'VALOR',right-16,y,7,boldFont,'center');
  y -= 10;
  for (const expense of (report.expenses || [])) {
    const lines = wrap(`${expense.description || 'Gasto'}${expense.note ? ` — ${expense.note}` : ''}`,62);
    const h = Math.max(16, lines.length * 9);
    if (y - h < 55) { newPage(); section('GASTOS DEL PERÍODO (CONTINUACIÓN)'); }
    drawText(ops,String(expense.date || ''),margin,y,7);
    lines.slice(0,3).forEach((t,i)=>drawText(ops,t,margin+75,y-i*9,7));
    drawText(ops,money(expense.amount),right,y,7,boldFont,'right');
    y -= h + 5;
    line(ops,margin,y,right,y,.35); y -= 7;
  }

  if (y < 120) newPage();
  y -= 8;
  fill(ops,margin,y-88,right-margin,88,0.95,0.92,0.84);
  rect(ops,margin,y-88,right-margin,88,.8);
  drawText(ops,'DESGLOSE FINAL',margin+10,y-16,9,boldFont);
  drawText(ops,'Ventas',margin+10,y-33,8); drawText(ops,money(report.totals.sales),right-10,y-33,8,normalFont,'right');
  drawText(ops,'Compras',margin+10,y-47,8); drawText(ops,money(report.totals.purchases),right-10,y-47,8,normalFont,'right');
  drawText(ops,'Gastos',margin+10,y-61,8); drawText(ops,money(report.totals.expenses),right-10,y-61,8,normalFont,'right');
  drawText(ops,'GANANCIA NETA',right-150,y-75,8,boldFont,'right'); drawText(ops,money(report.totals.profit),right-10,y-75,8,boldFont,'right');

  pages.push(ops.join('\n'));

  const imageObjectNumber = 3 + pages.length * 2;
  const fontNormal = imageObjectNumber + 1;
  const fontBold = fontNormal + 1;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`
  ];
  pages.forEach((stream,i)=>{
    const pageNo=3+i*2, contentNo=pageNo+1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /ProcSet [/PDF /Text /ImageC] /Font << /F1 ${fontNormal} 0 R /F2 ${fontBold} 0 R >> /XObject << /Im1 ${imageObjectNumber} 0 R >> >> /Contents ${contentNo} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  if (logoJpeg) {
    objects.push(`<< /Type /XObject /Subtype /Image /Width 839 /Height 184 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpeg.length} >>\nstream\n${logoJpeg.toString('latin1')}\nendstream`);
  } else {
    objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n\xff\xff\xff\nendstream');
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  let pdf='%PDF-1.4\n', offsets=[0];
  objects.forEach((object,index)=>{ offsets.push(Buffer.byteLength(pdf,'latin1')); pdf+=`${index+1} 0 obj\n${object}\nendobj\n`; });
  const xref=Buffer.byteLength(pdf,'latin1');
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<offsets.length;i++) pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'latin1');
}


app.get('/api/admin/resumen-financiero/pdf', requireAdmin, (req, res) => {
  const orders = readOrders();
  const products = readProducts().map(normalizeProduct);
  const users = readUsers();
  const expenses = readExpenses();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : '';
  const localDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  };
  const activeStatuses = new Set(['Pendiente', 'Confirmado', 'Preparado', 'Enviado', 'Entregado']);
  const productMap = new Map(products.map(product => [String(product.id), product]));
  const sellerMap = new Map(users.filter(user => isSellerRole(user.role)).map(user => [String(user.id), user]));
  const filteredOrders = orders.filter(order => {
    const date = localDate(order.createdAt);
    return date && (!from || date >= from) && (!to || date <= to) && activeStatuses.has(String(order.status || 'Pendiente'));
  });
  const filteredExpenses = expenses.filter(expense => {
    const date = String(expense.date || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && (!from || date >= from) && (!to || date <= to);
  });
  const round = value => Math.round(Number(value || 0) * 100) / 100;
  let sales=0,purchases=0,shipping=0;
  const salesBySeller=new Map();
  for (const order of filteredOrders) {
    sales += Number(order.total || 0);
    shipping += Number(order.shippingCost ?? order.delivery?.cost ?? 0);
    for (const item of Array.isArray(order.items) ? order.items : []) {
      if (item.purchaseMode !== 'purchase') continue;
      const fallback = productMap.get(String(item.productId || ''));
      const cost = Number.isFinite(Number(item.purchaseCost)) ? Number(item.purchaseCost) : Number(fallback?.purchasePrice || 0);
      purchases += Math.max(0,cost) * Math.max(0,Number(item.quantity || 0));
    }
    const sellerId=order.assignedSellerId || 'unassigned';
    const sellerName=order.assignedSellerName || sellerMap.get(String(order.assignedSellerId || ''))?.name || (sellerId==='unassigned'?'Sin vendedor':'Vendedor');
    const row=salesBySeller.get(sellerId)||{sellerId,sellerName,total:0,orders:0};
    row.total += Number(order.total || 0); row.orders += 1; salesBySeller.set(sellerId,row);
  }
  const manualExpenses=filteredExpenses.reduce((sum,e)=>sum+Number(e.amount||0),0);
  const totalExpenses=shipping+manualExpenses;
  const totalSales=round(sales), totalPurchases=round(purchases), totalShipping=round(shipping);
  const totalManualExpenses=round(manualExpenses), totalExpensesRounded=round(totalExpenses);
  const profit=round(totalSales-totalPurchases-totalExpensesRounded);
  const margin=totalSales>0?round(profit/totalSales*100):0;
  const report={
    from,to,
    generatedAt:new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'medium'}).format(new Date()),
    totals:{sales:totalSales,purchases:totalPurchases,shipping:totalShipping,manualExpenses:totalManualExpenses,expenses:totalExpensesRounded,profit,margin,orderCount:filteredOrders.length},
    expenses:filteredExpenses.map(e=>({...e,amount:round(e.amount)})).sort((a,b)=>String(b.date).localeCompare(String(a.date))),
    salesBySeller:[...salesBySeller.values()].sort((a,b)=>b.total-a.total).map(r=>({...r,total:round(r.total)}))
  };
  const pdf=buildFinancialReportPdf(report);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`inline; filename="YHORS-Resumen-Financiero-${from||'todo'}-${to||'todo'}.pdf"`);
  res.setHeader('Content-Length',pdf.length);
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma','no-cache'); res.setHeader('Expires','0');
  res.end(pdf);
});

app.post('/api/admin/gastos', requireAdmin, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? String(req.body.date) : '';
  const description = cleanText(req.body?.description, 120);
  const note = cleanText(req.body?.note, 500);
  const amount = Number(req.body?.amount);
  if (!date) return res.status(400).json({ error: 'Selecciona una fecha válida para el gasto.' });
  if (!description) return res.status(400).json({ error: 'Ingresa una descripción para el gasto.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Ingresa un valor de gasto válido.' });
  const expenses = readExpenses();
  const expense = { id: crypto.randomUUID(), date, description, amount: Math.round(amount * 100) / 100, note, createdAt: new Date().toISOString(), createdBy: getSession(req)?.accountId || null };
  expenses.push(expense);
  writeExpenses(expenses);
  return res.status(201).json({ ...expense });
});

app.put('/api/admin/gastos/:id', requireAdmin, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? String(req.body.date) : '';
  const description = cleanText(req.body?.description, 120);
  const note = cleanText(req.body?.note, 500);
  const amount = Number(req.body?.amount);
  if (!date) return res.status(400).json({ error: 'Selecciona una fecha válida para el gasto.' });
  if (!description) return res.status(400).json({ error: 'Ingresa una descripción para el gasto.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Ingresa un valor de gasto válido.' });
  const expenses = readExpenses();
  const index = expenses.findIndex(expense => String(expense.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Gasto no encontrado.' });
  const current = expenses[index];
  const updated = {
    ...current,
    date,
    description,
    amount: Math.round(amount * 100) / 100,
    note,
    updatedAt: new Date().toISOString(),
    updatedBy: getSession(req)?.accountId || null
  };
  expenses[index] = updated;
  writeExpenses(expenses);
  return res.json(updated);
});

app.delete('/api/admin/gastos/:id', requireAdmin, (req, res) => {
  const expenses = readExpenses();
  const next = expenses.filter(expense => String(expense.id) !== String(req.params.id));
  if (next.length === expenses.length) return res.status(404).json({ error: 'Gasto no encontrado.' });
  writeExpenses(next);
  return res.status(204).end();
});



app.get('/api/admin/multas', requireAdmin, (req, res) => {
  const fines = readFines();
  const users = readUsers();
  const userMap = new Map(users.map(user => [String(user.id), user]));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : '';

  const rows = fines
    .filter(fine => (!from || String(fine.date || '') >= from) && (!to || String(fine.date || '') <= to))
    .map(fine => {
      const user = userMap.get(String(fine.userId));
      return {
        ...fine,
        userName: fine.userName || user?.name || 'Usuario',
        userRole: fine.userRole || (isStoreManager(user?.role) ? 'store_manager' : 'vendedor')
      };
    })
    .sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));

  const total = rows.reduce((sum, fine) => sum + Number(fine.amount || 0), 0);
  return res.json({ fines: rows, total: Math.round(total * 100) / 100, filters: { from, to } });
});

app.post('/api/admin/multas', requireAdmin, (req, res) => {
  const userId = cleanText(req.body?.userId, 100);
  const reason = cleanText(req.body?.reason, 500);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? String(req.body.date) : '';
  const amount = Number(req.body?.amount);

  if (!userId) return res.status(400).json({ error: 'Selecciona un vendedor o Jefe de Tienda.' });
  if (!reason) return res.status(400).json({ error: 'Escribe el motivo de la multa.' });
  if (!date) return res.status(400).json({ error: 'Selecciona una fecha válida.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    return res.status(400).json({ error: 'Ingresa un valor de multa válido.' });
  }

  const users = readUsers();
  const user = users.find(item =>
    String(item.id) === userId &&
    item.active !== false &&
    (isSellerRole(item.role) || isStoreManager(item.role))
  );
  if (!user) return res.status(404).json({ error: 'El usuario seleccionado no es un vendedor o Jefe de Tienda activo.' });

  const fine = {
    id: crypto.randomUUID(),
    date,
    userId: user.id,
    userName: user.name || user.username || 'Usuario',
    username: user.username || '',
    userRole: isStoreManager(user.role) ? 'store_manager' : 'vendedor',
    amount: Math.round(amount * 100) / 100,
    reason,
    createdAt: new Date().toISOString(),
    createdBy: getSession(req)?.accountId || null
  };

  const fines = readFines();
  fines.push(fine);
  writeFines(fines);
  auditLog(req, 'Multa registrada', 'Finanzas', {
    fineId: fine.id,
    userId: fine.userId,
    username: fine.username,
    role: fine.userRole,
    amount: fine.amount,
    reason: fine.reason,
    date: fine.date
  });
  return res.status(201).json(fine);
});

app.put('/api/admin/multas/:id', requireAdmin, (req, res) => {
  const fines = readFines();
  const index = fines.findIndex(item => String(item.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Multa no encontrada.' });

  const current = fines[index];
  const userId = cleanText(req.body?.userId, 100);
  const reason = cleanText(req.body?.reason, 500);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? String(req.body.date) : '';
  const amount = Number(req.body?.amount);

  if (!userId) return res.status(400).json({ error: 'Selecciona un vendedor o Jefe de Tienda.' });
  if (!reason) return res.status(400).json({ error: 'Escribe el motivo de la multa.' });
  if (!date) return res.status(400).json({ error: 'Selecciona una fecha válida.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    return res.status(400).json({ error: 'Ingresa un valor de multa válido.' });
  }

  const users = readUsers();
  const user = users.find(item =>
    String(item.id) === userId &&
    item.active !== false &&
    (isSellerRole(item.role) || isStoreManager(item.role))
  );
  if (!user) return res.status(404).json({ error: 'El usuario seleccionado no es un vendedor o Jefe de Tienda activo.' });

  const updated = {
    ...current,
    date,
    userId: user.id,
    userName: user.name || user.username || 'Usuario',
    username: user.username || '',
    userRole: isStoreManager(user.role) ? 'store_manager' : 'vendedor',
    amount: Math.round(amount * 100) / 100,
    reason,
    updatedAt: new Date().toISOString(),
    updatedBy: getSession(req)?.accountId || null
  };

  fines[index] = updated;
  writeFines(fines);
  auditLog(req, 'Multa modificada', 'Finanzas', {
    fineId: updated.id,
    userId: updated.userId,
    username: updated.username,
    role: updated.userRole,
    amount: updated.amount,
    reason: updated.reason,
    date: updated.date,
    previous: { userId: current.userId, amount: current.amount, reason: current.reason, date: current.date }
  });
  return res.json(updated);
});

app.delete('/api/admin/multas/:id', requireAdmin, (req, res) => {
  const fines = readFines();
  const fine = fines.find(item => String(item.id) === String(req.params.id));
  if (!fine) return res.status(404).json({ error: 'Multa no encontrada.' });

  const next = fines.filter(item => String(item.id) !== String(req.params.id));
  writeFines(next);
  auditLog(req, 'Multa eliminada', 'Finanzas', {
    fineId: fine.id,
    userId: fine.userId,
    username: fine.username,
    amount: fine.amount,
    reason: fine.reason,
    date: fine.date
  });
  return res.status(204).end();
});

app.get('/api/admin/calculo-comision', requireAdmin, (req, res) => {
  const sales = readSales();
  const users = readUsers();
  const expenses = readExpenses();
  const fines = readFines();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : '';
  const localDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  };
  const qualifyingStatuses = new Set(['Enviado', 'Entregado']);
  const sellers = users
    .filter(user => isSellerRole(user.role) && user.active !== false)
    .map(user => ({ id: user.id, name: user.name, username: user.username, role: 'vendedor' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const rows = new Map(sellers.map(user => [String(user.id), {
    userId: user.id, name: user.name, username: user.username, role: 'vendedor',
    orderCount: 0, sales: 0, paid: false, paidExpenseId: null, paidAmount: 0
  }]));
  const manager = users.find(user => isStoreManager(user.role) && user.active !== false);
  const managerRow = manager ? {
    userId: manager.id, name: manager.name || 'Jefe de Tienda', username: manager.username || '',
    role: 'store_manager', orderCount: 0, sales: 0, paid: false, paidExpenseId: null, paidAmount: 0
  } : {
    userId: 'store_manager', name: 'Jefe de Tienda', username: '', role: 'store_manager',
    orderCount: 0, sales: 0, paid: false, paidExpenseId: null, paidAmount: 0
  };

  for (const sale of sales) {
    const date = localDate(sale.notifiedAt || sale.createdAt);
    const status = String(sale.status || 'Enviado');
    if (!date || (from && date < from) || (to && date > to) || !qualifyingStatuses.has(status)) continue;
    const total = Number(sale.total || 0);
    const seller = rows.get(String(sale.assignedSellerId || ''));
    if (seller) { seller.orderCount += 1; seller.sales += total; }
    managerRow.orderCount += 1; managerRow.sales += total;
  }

  const paidFor = (userId) => expenses
    .filter(expense => expense.type === 'commission'
      && String(expense.commissionUserId || '') === String(userId)
      && String(expense.commissionFrom || '') === from
      && String(expense.commissionTo || '') === to)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;

  const round = value => Math.round(Number(value || 0) * 100) / 100;
  const finesByUser = new Map();
  for (const fine of fines) {
    const fineDate = String(fine.date || '');
    if (!fineDate || (from && fineDate < from) || (to && fineDate > to)) continue;
    const key = String(fine.userId || '');
    finesByUser.set(key, round((finesByUser.get(key) || 0) + Number(fine.amount || 0)));
  }

  const normalized = [...rows.values(), managerRow].map(row => {
    const paid = paidFor(row.userId);
    const finesAmount = round(finesByUser.get(String(row.userId)) || 0);
    return {
      ...row,
      sales: round(row.sales),
      fines: finesAmount,
      paid: Boolean(paid),
      paidExpenseId: paid?.id || null,
      paidAmount: round(paid?.amount || 0),
      paidRate: Number(paid?.commissionRate || 0),
      paidGrossAmount: round(paid?.commissionGrossAmount || 0),
      paidFines: round(paid?.commissionFines || 0)
    };
  });
  const totalSales = round(normalized.reduce((sum, row) => sum + row.sales, 0) - managerRow.sales);
  const qualifyingOrders = normalized.filter(row => row.role === 'vendedor').reduce((sum, row) => sum + row.orderCount, 0);

  return res.json({
    filters: { from, to },
    statuses: ['Enviado', 'Entregado'],
    rows: normalized,
    totals: { sales: totalSales, orderCount: qualifyingOrders, managerSales: round(managerRow.sales) }
  });
});

app.post('/api/admin/calculo-comision/pagar', requireAdmin, (req, res) => {
  const userId = cleanText(req.body?.userId, 100);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.from || '')) ? String(req.body.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.to || '')) ? String(req.body.to) : '';
  const rate = Number(req.body?.rate);
  if (!userId) return res.status(400).json({ error: 'Selecciona un usuario para pagar la comisión.' });
  if (!from || !to || from > to) return res.status(400).json({ error: 'Selecciona un período válido.' });
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return res.status(400).json({ error: 'El porcentaje debe estar entre 0,01% y 100%.' });

  const users = readUsers();
  // El Jefe de Tienda puede tener un ID real (como cualquier otra cuenta).
  // Aceptamos tanto el identificador histórico "store_manager" como su ID real.
  const managerUser = users.find(item =>
    String(item.id) === userId && isStoreManager(item.role) && item.active !== false
  );
  const isManager = userId === 'store_manager' || Boolean(managerUser);
  const user = isManager
    ? (managerUser || users.find(item => isStoreManager(item.role) && item.active !== false))
    : users.find(item => String(item.id) === userId && isSellerRole(item.role) && item.active !== false);
  if (!user && !isManager) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const historySales = readSales();
  const fines = readFines();
  const qualifyingStatuses = new Set(['Enviado', 'Entregado']);
  const localDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  };
  let sales = 0;
  for (const sale of historySales) {
    const date = localDate(sale.notifiedAt || sale.createdAt);
    if (!date || date < from || date > to || !qualifyingStatuses.has(String(sale.status || 'Enviado'))) continue;
    if (isManager || String(sale.assignedSellerId || '') === String(user.id)) sales += Number(sale.total || 0);
  }
  sales = Math.round(sales * 100) / 100;
  const grossAmount = Math.round(sales * (rate / 100) * 100) / 100;
  const fineAmount = Math.round(fines
    .filter(fine => String(fine.userId || '') === String(user?.id || userId)
      && String(fine.date || '') >= from
      && String(fine.date || '') <= to)
    .reduce((sum, fine) => sum + Number(fine.amount || 0), 0) * 100) / 100;
  const amount = Math.max(0, Math.round((grossAmount - fineAmount) * 100) / 100);
  if (sales <= 0) return res.status(400).json({ error: 'No hay ventas Enviado o Entregado para calcular esta comisión en el período.' });
  if (grossAmount <= 0) return res.status(400).json({ error: 'La comisión bruta calculada es $0,00.' });
  if (amount <= 0) return res.status(400).json({ error: 'Las multas consumen toda la comisión de este período. No hay saldo de comisión para pagar.' });

  const expenses = readExpenses();
  const existing = expenses.find(expense => expense.type === 'commission'
    && String(expense.commissionUserId || '') === userId
    && String(expense.commissionFrom || '') === from
    && String(expense.commissionTo || '') === to);
  if (existing) {
    return res.status(409).json({ error: `La comisión de este usuario para ${from} → ${to} ya fue pagada.`, expense: existing });
  }

  const recipientName = user?.name || 'Jefe de Tienda';
  const expense = {
    id: crypto.randomUUID(),
    date: to,
    description: `Comisión — ${recipientName}`,
    amount,
    note: `Comisión ${rate}% sobre ${sales.toFixed(2)} de ventas Enviado + Entregado · bruta ${grossAmount.toFixed(2)} · multas ${fineAmount.toFixed(2)} · neta ${amount.toFixed(2)} · período ${from} → ${to}.`,
    type: 'commission',
    commissionGrossAmount: grossAmount,
    commissionFines: fineAmount,
    commissionUserId: user?.id || 'store_manager',
    commissionRole: isManager ? 'store_manager' : 'vendedor',
    commissionFrom: from,
    commissionTo: to,
    commissionRate: rate,
    commissionBase: sales,
    createdAt: new Date().toISOString(),
    createdBy: getSession(req)?.accountId || null
  };
  expenses.push(expense);
  writeExpenses(expenses);
  return res.status(201).json(expense);
});

app.get('/api/admin/historial-ventas', requireOrdersAccess, (req, res) => {
  const session = getSession(req); let sales = readSales();
  if (isSellerRole(session.role)) sales = sales.filter(s => String(s.assignedSellerId||'')===String(session.accountId||''));
  const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||''))?String(req.query.from):'';
  const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||''))?String(req.query.to):'';
  const sellerId=String(req.query.sellerId||'').trim(); const q=String(req.query.q||'').trim().toLowerCase();
  const localDate=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});};
  sales=sales.filter(s=>{const date=localDate(s.notifiedAt||s.createdAt); if(!date||(from&&date<from)||(to&&date>to))return false; if(sellerId&&String(s.assignedSellerId||'')!==sellerId)return false; if(q){const hay=`${s.orderNumber||''} ${s.customer?.name||''} ${s.customer?.cedula||''} ${s.customer?.phone||''} ${s.customer?.email||''} ${s.assignedSellerName||''} ${(s.items||[]).map(i=>`${i.name||''} ${i.sku||''}`).join(' ')}`.toLowerCase();if(!hay.includes(q))return false;}return true;});
  sales.sort((a,b)=>String(b.notifiedAt||b.createdAt||'').localeCompare(String(a.notifiedAt||a.createdAt||''))); return res.json(sales.map(decorateOrderAssignment));
});
app.post('/api/admin/orders/:id/notificar-venta', requireOrdersAccess, (req,res)=>{
  const session=getSession(req), orders=readOrders(), index=orders.findIndex(o=>o.id===req.params.id); if(index<0)return res.status(404).json({error:'Pedido no encontrado.'}); const order=orders[index];
  if(isSellerRole(session.role)&&order.assignedSellerId!==session.accountId)return res.status(403).json({error:'Este pedido no está asignado a tu usuario.'});
  if(!['Enviado','Entregado'].includes(String(order.status||'')))return res.status(400).json({error:'Solo puedes notificar una venta cuando el pedido está Enviado o Entregado.'});
  if(order.salesNotifiedAt||order.salesHistoryId)return res.status(409).json({error:'Esta venta ya fue notificada y está en Historial de ventas.'});
  const sales=readSales(); if(sales.some(s=>String(s.orderId)===String(order.id)))return res.status(409).json({error:'Esta venta ya existe en Historial de ventas.'});
  const sale=getSalesHistoryRecord(decorateOrderAssignment(order),req); sales.unshift(sale); try{writeSales(sales);}catch(e){return res.status(500).json({error:'No se pudo guardar la venta en Historial de ventas.'});}
  order.salesNotifiedAt=sale.notifiedAt; order.salesHistoryId=sale.id; order.updatedAt=sale.notifiedAt; orders[index]=order; try{writeOrders(orders);}catch(e){writeSales(sales.filter(s=>s.id!==sale.id));return res.status(500).json({error:'No se pudo cerrar el pedido como venta.'});}
  auditLog(req,'Venta notificada','Historial de ventas',{orderId:order.id,orderNumber:order.orderNumber,salesId:sale.id,status:order.status,total:order.total}); return res.status(201).json(decorateOrderAssignment(sale));
});
app.patch('/api/admin/historial-ventas/:id/nota', requireAdmin, (req,res)=>{
  const sales=readSales(); const index=sales.findIndex(s=>s.id===req.params.id);
  if(index<0)return res.status(404).json({error:'Venta no encontrada en Historial de ventas.'});
  const note=cleanText(req.body?.internalNote,5000);
  const sale=sales[index];
  sale.internalNote=note; sale.updatedAt=new Date().toISOString();
  try{ writeSales(sales); }catch(e){ return res.status(500).json({error:'No se pudo guardar la nota interna.'}); }
  const orders=readOrders(); const orderIndex=orders.findIndex(o=>String(o.id)===String(sale.orderId));
  if(orderIndex>=0){ orders[orderIndex].internalNote=note; orders[orderIndex].updatedAt=sale.updatedAt; try{ writeOrders(orders); }catch(e){} }
  auditLog(req,'Nota interna de venta actualizada','Historial de ventas',{salesId:sale.id,orderId:sale.orderId,orderNumber:sale.orderNumber});
  return res.json(decorateOrderAssignment(sale));
});
app.delete('/api/admin/historial-ventas/:id', requireAdmin, (req,res)=>{
  const sales=readSales(), sale=sales.find(s=>s.id===req.params.id); if(!sale)return res.status(404).json({error:'Venta no encontrada en Historial de ventas.'}); const orders=readOrders(), index=orders.findIndex(o=>String(o.id)===String(sale.orderId));
  if(index>=0){const order=orders[index];delete order.salesNotifiedAt;delete order.salesHistoryId;order.updatedAt=new Date().toISOString();orders[index]=order;writeOrders(orders);} writeSales(sales.filter(s=>s.id!==req.params.id)); auditLog(req,'Venta eliminada del historial','Historial de ventas',{salesId:sale.id,orderId:sale.orderId,orderNumber:sale.orderNumber,total:sale.total}); return res.status(204).end();
});
app.get('/api/admin/historial-ventas/:id/pdf', requireOrdersAccess, (req,res)=>{
  const sale=readSales().find(s=>s.id===req.params.id); if(!sale)return res.status(404).json({error:'Venta no encontrada.'}); const session=getSession(req); if(isSellerRole(session.role)&&String(sale.assignedSellerId||'')!==String(session.accountId||''))return res.status(403).json({error:'Esta venta no está asignada a tu usuario.'}); const pdf=buildOrderPdf(decorateOrderAssignment(sale)); const safeName=String(sale.orderNumber||sale.id||'venta').replace(/[^a-zA-Z0-9_-]/g,'_'); res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="YHORS-VENTA-${safeName}.pdf"`);res.setHeader('Content-Length',pdf.length);res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');res.end(pdf);
});

app.get('/api/admin/ventas-generales', requireOrdersAccess, (req,res)=>{
  const session=getSession(req); let sales=readSales(); if(isSellerRole(session.role))sales=sales.filter(s=>String(s.assignedSellerId||'')===String(session.accountId||''));
  const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||''))?String(req.query.from):''; const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||''))?String(req.query.to):''; const status=String(req.query.status||'all'); const localDate=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});};
  sales=sales.filter(s=>{const date=localDate(s.notifiedAt||s.createdAt);return date&&(!from||date>=from)&&(!to||date<=to)&&(status==='all'||String(s.status||'')===status);});
  const users=readUsers(), sellers=users.filter(u=>isSellerRole(u.role)).map(u=>({id:u.id,name:u.name,username:u.username,active:u.active!==false})); const rows=new Map(sellers.map(u=>[String(u.id),{sellerId:u.id,sellerName:u.name,username:u.username,active:u.active,orderCount:0,subtotal:0,shipping:0,total:0}])); const unassigned={sellerId:null,sellerName:'Sin vendedor',username:'',active:true,orderCount:0,subtotal:0,shipping:0,total:0};
  for(const s of sales){const row=rows.get(String(s.assignedSellerId||''))||unassigned;row.orderCount++;row.subtotal+=Number(s.subtotal||0);row.shipping+=Number(s.shippingCost||s.delivery?.cost||0);row.total+=Number(s.total||0);} const round=v=>Math.round(Number(v||0)*100)/100; const normalized=[...rows.values()].map(r=>({...r,subtotal:round(r.subtotal),shipping:round(r.shipping),total:round(r.total)}));if(unassigned.orderCount)normalized.push({...unassigned,subtotal:round(unassigned.subtotal),shipping:round(unassigned.shipping),total:round(unassigned.total)}); return res.json({rows:normalized,totals:{orderCount:sales.length,subtotal:round(normalized.reduce((a,r)=>a+r.subtotal,0)),shipping:round(normalized.reduce((a,r)=>a+r.shipping,0)),total:round(normalized.reduce((a,r)=>a+r.total,0))},filters:{from,to,status},statuses:['Enviado','Entregado']});
});

app.get('/api/admin/orders/:id/pdf', requireOrdersAccess, (req, res) => {
  const order = readOrders().find(item => item.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });

  const session = getSession(req);
  if (isSellerRole(session.role) && order.assignedSellerId !== session.accountId) {
    return res.status(403).json({ error: 'Este pedido no está asignado a tu usuario.' });
  }

  // Resolver el vendedor justo antes de generar el PDF para que siempre use
  // la asignación/nombre actual guardados en YHORS, incluso si otro administrador
  // cambió el vendedor o actualizó su nombre.
  const pdfOrder = decorateOrderAssignment(order);
  const pdf = buildOrderPdf(pdfOrder);
  const safeName = String(order.orderNumber || order.id || 'orden').replace(/[^a-zA-Z0-9_-]/g, '_');
  // El PDF se genera en cada solicitud con los datos actuales del pedido.
  // Evitamos que el navegador reutilice una versión anterior después de guardar cambios.
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="YHORS-${safeName}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.end(pdf);
});

app.get('/api/admin/orders', requireOrdersAccess, (req, res) => {
  const session = getSession(req);
  let orders = readOrders().filter(order => !order.salesNotifiedAt && !order.salesHistoryId);
// Los vendedores ven sus pedidos asignados y también los pedidos que aún no tienen vendedor,
  // para que puedan detectar y atender compras realizadas por la web que quedaron sin asignar.
  if (isSellerRole(session.role)) {
    orders = orders.filter(order => !order.assignedSellerId || order.assignedSellerId === session.accountId);
  }
  return res.json(orders.map(decorateOrderAssignment));
});


function buildEditedOrderItems(requestedItems, products) {
  if (!Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 50) {
    throw new Error('El pedido debe contener entre 1 y 50 productos.');
  }

  const byId = new Map(products.map(product => [String(product.id), product]));
  const items = [];

  for (const requested of requestedItems) {
    const product = byId.get(String(requested?.productId || ''));
    const quantity = Number.parseInt(requested?.quantity, 10);
    if (!product) throw new Error('Uno de los productos seleccionados ya no existe en el inventario.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error(`La cantidad de “${product.name}” debe estar entre 1 y 99.`);
    }

    const purchaseMode = requested?.purchaseMode === 'rental' ? 'rental' : 'purchase';
    const rentalDays = purchaseMode === 'rental' ? Number.parseInt(requested?.rentalDays, 10) : null;
    if (purchaseMode === 'rental' && (!Number.isInteger(rentalDays) || rentalDays < 1 || rentalDays > 10)) {
      throw new Error(`El alquiler de “${product.name}” debe tener entre 1 y 10 días.`);
    }

    const price = purchaseMode === 'rental'
      ? Number(product.rentalPrice)
      : Number(product.salePrice ?? product.price);

    if (!Number.isFinite(price) || price < 0 || (purchaseMode === 'rental' && product.rentalPrice === null)) {
      throw new Error(`El producto “${product.name}” no tiene un precio válido para ${purchaseMode === 'rental' ? 'alquiler' : 'compra'}.`);
    }

    const durationMultiplier = purchaseMode === 'rental' ? rentalDays : 1;
    let deviceIdentifiers = [];
    if (purchaseMode === 'purchase' && isTechProduct(product) && product.requiresDeviceIdentifier !== false) {
      // Para productos TEC que requieren identificación, una orden puede guardarse
      // con un identificador temporal "SN" y luego reemplazarse desde la edición
      // del pedido o desde SERIES/IMEIS.
      let requestedIdentifiers = Array.isArray(requested?.deviceIdentifiers)
        ? requested.deviceIdentifiers.map(entry => ({ ...entry }))
        : [];
      if (!isImeiProduct(product)) {
        for (let unit = 1; unit <= quantity; unit += 1) {
          if (!requestedIdentifiers[unit - 1]?.primary) {
            requestedIdentifiers[unit - 1] = {
              ...(requestedIdentifiers[unit - 1] || {}),
              primary: unit === 1 ? 'SN' : `SN-${unit}`,
              secondary: requestedIdentifiers[unit - 1]?.secondary || null
            };
          }
        }
      }
      deviceIdentifiers = normalizeDeviceIdentifiers(requestedIdentifiers, product, quantity, { required: true });
    }

    items.push({
      productId: product.id,
      sku: product.sku || '',
      name: product.name,
      category: product.category,
      purchaseMode,
      rentalDays,
      quantity,
      deviceIdentifiers,
      unitPrice: Math.round(price * 100) / 100,
      purchaseCost: purchaseMode === 'purchase' ? Math.round(Math.max(0, Number(product.purchasePrice) || 0) * 100) / 100 : 0,
      subtotal: Math.round(price * quantity * durationMultiplier * 100) / 100
    });
  }

  // Evita líneas duplicadas idénticas y conserva separadas las modalidades/duraciones distintas.
  const merged = new Map();
  for (const item of items) {
    const key = `${item.productId}|${item.purchaseMode}|${item.rentalDays || ''}|${item.unitPrice}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.subtotal = Math.round(existing.unitPrice * existing.quantity * (existing.purchaseMode === 'rental' ? existing.rentalDays : 1) * 100) / 100;
      if (existing.quantity > 99) throw new Error(`La cantidad total de “${item.name}” no puede superar 99.`);
    } else {
      merged.set(key, { ...item });
    }
  }

  const result = [...merged.values()];
  validateDeviceIdentifiersAcrossOrder(result);
  return result;
}

function applyOrderItemStockDelta(currentOrder, nextItems) {
  if (!orderStatusUsesStock(currentOrder.status || 'Pendiente')) return [];

  const currentDemand = getStockDemand(currentOrder);
  const nextDemand = getStockDemand({ items: nextItems });
  const products = readProducts().map(normalizeProduct);
  const ids = new Set([...currentDemand.keys(), ...nextDemand.keys()]);

  for (const productId of ids) {
    const before = Number(currentDemand.get(productId) || 0);
    const after = Number(nextDemand.get(productId) || 0);
    const delta = after - before;
    if (delta <= 0) continue;
    const product = products.find(p => String(p.id) === String(productId));
    if (!product) throw new Error(`El producto del pedido ya no existe: ${productId}`);
    const available = Number(product.stock || 0);
    if (!Number.isInteger(available) || available < delta) {
      throw new Error(`No hay suficiente stock de “${product.name}”. Disponible: ${available}, adicional requerido: ${delta}.`);
    }
  }

  const movements = [];
  const updated = products.map(product => {
    const before = Number(currentDemand.get(String(product.id)) || 0);
    const after = Number(nextDemand.get(String(product.id)) || 0);
    const delta = after - before;
    if (!delta) return product;
    const currentStock = Number(product.stock || 0);
    const nextStock = Math.max(0, currentStock - delta);
    movements.push({
      productId: product.id,
      sku: product.sku || '',
      name: product.name || '',
      quantity: Math.abs(delta),
      direction: delta > 0 ? 'salida' : 'entrada',
      before: currentStock,
      after: nextStock,
      reason: delta > 0 ? 'Aumento de cantidad en pedido' : 'Reducción de cantidad en pedido'
    });
    return normalizeProduct({
      ...product,
      stock: nextStock,
      updatedAt: new Date().toISOString()
    });
  });

  if (movements.length) writeProducts(updated);
  return movements;
}

app.put('/api/admin/orders/:id', requireOrdersAccess, (req, res) => {
  const allowed = ['Pendiente', 'Confirmado', 'Preparado', 'Enviado', 'Entregado', 'Cancelado'];
  const body = req.body || {};
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
  const hasInternalNote = Object.prototype.hasOwnProperty.call(body, 'internalNote');
  const hasAssignment = Object.prototype.hasOwnProperty.call(body, 'assignedSellerId');
  const hasItems = Object.prototype.hasOwnProperty.call(body, 'items');
  if (!hasStatus && !hasInternalNote && !hasAssignment && !hasItems) return res.status(400).json({ error: 'No hay cambios para guardar.' });

  const session = getSession(req);
  const orders = readOrders();
  const index = orders.findIndex(order => order.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Pedido no encontrado.' });
  const currentOrder = orders[index];
  if (currentOrder.salesNotifiedAt || currentOrder.salesHistoryId) return res.status(409).json({ error: 'Este pedido ya está en Historial de ventas. Primero elimina la venta desde Historial de ventas para volver a editarlo.' });
  if (isSellerRole(session.role) && currentOrder.assignedSellerId !== session.accountId) {
    return res.status(403).json({ error: 'Este pedido no está asignado a tu usuario.' });
  }

  let nextItems = currentOrder.items || [];
  if (hasItems) {
    try {
      const products = readProducts().map(normalizeProduct);
      nextItems = buildEditedOrderItems(body.items, products);
    } catch (error) {
      return res.status(400).json({ error: error.message || 'No se pudieron validar los productos del pedido.' });
    }
  }

  if (hasAssignment && !isStoreManager(session.role) && !isAdmin(session.role)) {
    return res.status(403).json({ error: 'Solo el Jefe de tienda o un administrador puede asignar o cambiar el vendedor.' });
  }

  let normalizedStatus = currentOrder.status || 'Pendiente';
  if (hasStatus) {
    const status = cleanText(body.status, 30);
    normalizedStatus = allowed.find(item => item.toLocaleLowerCase('es-EC') === status.toLocaleLowerCase('es-EC'));
    if (!normalizedStatus) return res.status(400).json({ error: 'Estado de pedido no válido.' });
  }

  let assignedSellerId = currentOrder.assignedSellerId || null;
  if (hasAssignment) {
    const requestedSellerId = body.assignedSellerId === null || body.assignedSellerId === '' ? null : String(body.assignedSellerId);
    if (requestedSellerId) {
      const seller = readUsers().find(user => user.id === requestedSellerId && user.active !== false && isSellerRole(user.role));
      if (!seller) return res.status(400).json({ error: 'El usuario seleccionado no es un vendedor activo.' });
      assignedSellerId = seller.id;
    } else {
      assignedSellerId = null;
    }
  }
  
  const previousStatus = String(currentOrder.status || 'Pendiente');
  const nextStatus = normalizedStatus;
  const previousUsesStock = orderStatusUsesStock(previousStatus);
  const nextUsesStock = orderStatusUsesStock(nextStatus);
  const statusChanged = previousStatus.toLocaleLowerCase('es-EC') !== nextStatus.toLocaleLowerCase('es-EC');

  // V15.3 — El stock y la auditoría se actualizan como una sola operación.
  // Cada cambio deja trazabilidad de producto, cantidad y stock antes/después.
  const stockMovements = [];
  try {
    if (hasItems && previousUsesStock === nextUsesStock) {
      stockMovements.push(...applyOrderItemStockDelta(currentOrder, nextItems));
    }
    if (statusChanged && previousUsesStock && !nextUsesStock) {
      stockMovements.push(...restoreOrderPurchaseStock(currentOrder));
    } else if (statusChanged && !previousUsesStock && nextUsesStock) {
      stockMovements.push(...reserveOrderStock(hasItems ? { ...currentOrder, items: nextItems } : currentOrder));
    }
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo sincronizar el inventario con el pedido.' });
  }

  const updated = { ...currentOrder, assignedSellerId, updatedAt: new Date().toISOString() };
  if (hasItems) {
    updated.items = nextItems;
    updated.subtotal = Math.round(nextItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0) * 100) / 100;
    updated.shippingCost = Number(currentOrder.shippingCost ?? currentOrder.delivery?.cost ?? 0) || 0;
    updated.total = Math.round((updated.subtotal + updated.shippingCost) * 100) / 100;
    updated.delivery = { ...(currentOrder.delivery || {}), cost: updated.shippingCost };
  }
  if (hasStatus) updated.status = normalizedStatus;
  if (orderStatusUsesStock(normalizedStatus)) {
    updated.stockReservedAt = currentOrder.stockReservedAt || new Date().toISOString();
    delete updated.stockRestoredAt;
  } else {
    updated.stockRestoredAt = currentOrder.stockRestoredAt || new Date().toISOString();
    delete updated.stockReservedAt;
  }

  if (hasInternalNote) updated.internalNote = cleanText(body.internalNote, 5000);
  orders[index] = updated;
  writeOrders(orders);
  auditLog(req, 'Pedido actualizado', 'Pedidos', {
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    changes: auditDiff(auditOrderSnapshot(currentOrder), auditOrderSnapshot(updated), ['status','assignedSellerId','internalNote','total','items']),
    inventory: stockMovements.length ? {
      synchronized: true,
      movements: stockMovements
    } : {
      synchronized: true,
      movements: []
    }
  });
  return res.json(decorateOrderAssignment(updated));
});


app.delete('/api/admin/orders/:id', requireStoreManagerOrAdmin, (req, res) => {
  const orders = readOrders();
  const order = orders.find(item => item.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  if (order.salesNotifiedAt || order.salesHistoryId) return res.status(409).json({ error: 'Este pedido está en Historial de ventas. Elimínalo primero desde Historial de ventas.' });

  let stockMovements = [];
  try {
    // Un pedido activo ya descontó/reservó stock al crearse.
    // Las versiones anteriores no guardaban stockReservedAt al crear el pedido,
    // así que NO debemos depender de esa marca para decidir si hay que devolverlo.
    // Si el pedido está Cancelado, su stock ya fue restaurado al cambiar de estado.
    // Para cualquier otro estado, eliminarlo debe devolver sus unidades.
    const stockWasRestored = Boolean(order.stockRestoredAt) || !orderStatusUsesStock(order.status);
    if (!stockWasRestored) {
      stockMovements = restoreOrderPurchaseStock(order);
    }
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo devolver el stock al inventario.' });
  }

  writeOrders(orders.filter(item => item.id !== req.params.id));
  auditLog(req, 'Pedido eliminado', 'Pedidos', {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    stockReturned: stockMovements.length > 0,
    inventory: {
      synchronized: true,
      movements: stockMovements
    },
    order: auditOrderSnapshot(order)
  });
  return res.status(204).end();
});



app.get('/api/admin/security/alerts', requireAdmin, (req, res) => {
  const entries = readAudit();
  const users = readUsers();
  const alerts = buildSecurityAlerts(entries, users);
  return res.json({
    version: 'V15.5',
    generatedAt: new Date().toISOString(),
    alerts,
    summary: {
      critical: alerts.filter(item => item.severity === 'critical').length,
      high: alerts.filter(item => item.severity === 'high').length,
      medium: alerts.filter(item => item.severity === 'medium').length,
      total: alerts.length
    }
  });
});

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  const entries = readAudit().slice().reverse();
  const users = readUsers();
  const userMap = new Map(users.map(user => [String(user.username || '').toLowerCase(), user]));
  entries.forEach(entry => {
    const user = userMap.get(String(entry.username || '').toLowerCase());
    if (user) {
      if (!entry.role) entry.role = user.role;
      if (!entry.accountId) entry.accountId = user.id;
    }
  });
  const q = String(req.query.q || '').trim().toLowerCase();
  const module = String(req.query.module || '').trim();
  const action = String(req.query.action || '').trim();
  const username = String(req.query.username || '').trim().toLowerCase();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const filtered = entries.filter(entry => {
    const date = String(entry.createdAt || '').slice(0, 10);
    const hay = JSON.stringify(entry).toLowerCase();
    return (!q || hay.includes(q))
      && (!module || entry.module === module)
      && (!action || entry.action === action)
      && (!username || String(entry.username || '').toLowerCase() === username)
      && (!from || date >= from)
      && (!to || date <= to);
  });
  res.json({
    entries: filtered.slice(0, 1000),
    total: filtered.length,
    availableModules: [...new Set(entries.map(e => e.module).filter(Boolean))].sort(),
    availableActions: [...new Set(entries.map(e => e.action).filter(Boolean))].sort(),
    availableUsers: [...new Set(entries.map(e => e.username).filter(Boolean))].sort()
  });
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

app.get('/api/admin/products', requireCatalogRead, (_, res) => res.json(readProducts().map(normalizeProduct)));

// Catálogo de consulta para vendedores, jefes y administradores. Nunca incluye
// precio de compra ni otros campos internos de administración.
app.get('/api/admin/catalog-products', requireOrdersAccess, (_, res) => {
  const products = readProducts().map(normalizeProduct).map(product => ({
    id: product.id,
    name: product.name,
    description: product.description || '',
    category: product.category,
    brand: product.brand || '',
    productType: product.productType || '',
    sku: product.sku || '',
    salePrice: Number(product.salePrice ?? product.price ?? 0),
    rentalPrice: product.rentalPrice ?? null,
    stock: Number(product.stock || 0),
    published: product.published !== false,
    image: product.image || '',
    images: Array.isArray(product.images) ? product.images.filter(Boolean) : []
  }));
  return res.json(products);
});

// Catálogo operativo: solo para construir órdenes. No expone el área administrativa
// de inventario ni habilita acciones de edición.
app.get('/api/admin/order-products', requireOrdersAccess, (_, res) => res.json(readProducts().map(normalizeProduct)));


// SERIES / IMEIS · configuración y gestión operativa.
// La configuración de qué productos TEC requieren identificación solo la modifica ADMIN.
app.get('/api/admin/series-imeis/config', requireAdmin, (_, res) => {
  const products = readProducts().map(normalizeProduct).filter(product => isTechProduct(product));
  return res.json(products.map(product => ({
    id: product.id,
    name: product.name,
    sku: product.sku || '',
    productType: product.productType || '',
    category: product.category,
    requiresDeviceIdentifier: product.requiresDeviceIdentifier !== false,
    stock: Number(product.stock || 0)
  })));
});

app.put('/api/admin/series-imeis/config', requireAdmin, (req, res) => {
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  if (changes.length > 500) return res.status(400).json({ error: 'Demasiados cambios en una sola operación.' });
  const products = readProducts();
  const allowed = new Set(changes.map(item => String(item?.id || '')));
  let changed = 0;
  const updated = products.map(product => {
    if (!allowed.has(String(product.id)) || !isTechProduct(product)) return product;
    const change = changes.find(item => String(item?.id || '') === String(product.id));
    if (!change || typeof change.requiresDeviceIdentifier !== 'boolean') return product;
    const next = { ...product, requiresDeviceIdentifier: change.requiresDeviceIdentifier, updatedAt: new Date().toISOString() };
    if (next.requiresDeviceIdentifier !== (product.requiresDeviceIdentifier !== false)) changed += 1;
    return next;
  });
  if (changed) writeProducts(updated);
  auditLog(req, 'Configuración de series/IMEIS actualizada', 'Series/IMEIS', { changed, changes: changes.slice(0, 500).map(item => ({ id: item.id, requiresDeviceIdentifier: item.requiresDeviceIdentifier })) });
  return res.json(updated.map(normalizeProduct).filter(product => isTechProduct(product)).map(product => ({
    id: product.id, name: product.name, sku: product.sku || '', productType: product.productType || '', category: product.category,
    requiresDeviceIdentifier: product.requiresDeviceIdentifier !== false, stock: Number(product.stock || 0)
  })));
});

function collectRegisteredIdentifiers() {
  // Las ventas son una copia del pedido. Consultamos ambos orígenes para que
  // una serie/IMEI siga apareciendo aunque el registro operativo haya cambiado
  // de estado o la venta ya esté en Historial de ventas.
  const sources = [...readOrders(), ...readSales()];
  const products = new Map(readProducts().map(product => [String(product.id), normalizeProduct(product)]));
  const rows = [];
  const seen = new Set();
  for (const order of sources) {
    const canonicalOrderId = String(order.orderId || order.id || '');
    for (const item of (Array.isArray(order.items) ? order.items : [])) {
      const product = products.get(String(item.productId));
      const identifiers = Array.isArray(item.deviceIdentifiers) ? item.deviceIdentifiers : [];
      const itemIndex = order.items.indexOf(item);
      const requiresIdentifier = product ? product.requiresDeviceIdentifier !== false : true;
      const byUnit = new Map(identifiers.map(entry => [Number(entry.unit || 1), entry]));
      const quantity = Math.max(0, Number(item.quantity || 0));
      for (let unit = 1; unit <= quantity; unit += 1) {
        const entry = byUnit.get(unit);
        const primary = cleanText(entry?.primary, 50);
        const secondary = cleanText(entry?.secondary, 50);
        // Mostrar siempre identificadores que ya fueron registrados, aunque la
        // configuración actual del producto haya cambiado a NO SOLICITAR.
        // La configuración controla nuevas órdenes; no debe ocultar el historial
        // de series/IMEIS que ya existen.
        if (!entry && !requiresIdentifier) continue;
        const rowKey = `${canonicalOrderId}|${itemIndex}|${unit}`;
        if (seen.has(rowKey)) continue;
        seen.add(rowKey);
        rows.push({
          orderId: canonicalOrderId,
          orderNumber: order.orderNumber || order.id,
          createdAt: order.createdAt || null,
          status: order.status || 'Pendiente',
          sellerId: order.assignedSellerId || null,
          sellerName: order.assignedSellerName || '',
          customerName: order.customer?.name || '',
          productId: item.productId,
          productName: item.name || product?.name || '',
          sku: item.sku || product?.sku || '',
          itemIndex,
          unit,
          type: entry?.type === 'imei' || isImeiProduct(product || {}) ? 'imei' : 'serial',
          primary,
          secondary: secondary || null,
          productRequiresIdentifier: requiresIdentifier,
          pending: !primary && !secondary
        });
      }
    }
  }
  return rows.sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

app.get('/api/admin/series-imeis/registered', requireStoreManagerOrAdmin, (req, res) => {
  const rows = collectRegisteredIdentifiers();
  const query = cleanText(req.query?.q, 120).toLocaleLowerCase('es-EC');
  const from = cleanText(req.query?.from, 10);
  const to = cleanText(req.query?.to, 10);
  const type = cleanText(req.query?.type, 20).toLowerCase();
  const status = cleanText(req.query?.status, 40).toLocaleLowerCase('es-EC');
  const seller = cleanText(req.query?.seller, 120).toLocaleLowerCase('es-EC');
  const filtered = rows.filter(row => {
    const hay = `${row.orderNumber} ${row.customerName} ${row.productName} ${row.sku} ${row.primary} ${row.secondary || ''} ${row.sellerName}`.toLocaleLowerCase('es-EC');
    if (query && !hay.includes(query)) return false;
    const date = row.createdAt ? new Date(row.createdAt) : null;
    const day = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(date) : '';
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (type && type !== row.type) return false;
    if (status && status !== String(row.status).toLocaleLowerCase('es-EC')) return false;
    if (seller && !String(row.sellerName).toLocaleLowerCase('es-EC').includes(seller)) return false;
    return true;
  });
  return res.json({ rows: filtered, total: filtered.length });
});

app.put('/api/admin/series-imeis/registered', requireStoreManagerOrAdmin, (req, res) => {
  const orderId = String(req.body?.orderId || '');
  const itemIndex = Number.parseInt(req.body?.itemIndex, 10);
  const unit = Number.parseInt(req.body?.unit, 10);
  if (!orderId || !Number.isInteger(itemIndex) || itemIndex < 0 || !Number.isInteger(unit) || unit < 1) {
    return res.status(400).json({ error: 'Registro de serie/IMEI no válido.' });
  }
  const orders = readOrders();
  const orderIndex = orders.findIndex(order => String(order.id) === orderId);
  if (orderIndex < 0) return res.status(404).json({ error: 'Pedido no encontrado.' });
  const order = orders[orderIndex];
  const item = Array.isArray(order.items) ? order.items[itemIndex] : null;
  if (!item) return res.status(404).json({ error: 'Producto del pedido no encontrado.' });
  if (String(item.purchaseMode || 'purchase') === 'rental') return res.status(400).json({ error: 'Los alquileres no usan series/IMEI.' });
  const product = readProducts().map(normalizeProduct).find(product => String(product.id) === String(item.productId));
  if (!product || !isTechProduct(product)) return res.status(400).json({ error: 'Este producto no pertenece a Tecnología.' });
  if (unit > Number(item.quantity || 0)) return res.status(400).json({ error: 'La unidad seleccionada supera la cantidad del pedido.' });
  const type = isImeiProduct(product) ? 'imei' : 'serial';
  const primary = cleanText(req.body?.primary, 50);
  const secondary = cleanText(req.body?.secondary, 50);
  if (!primary) return res.status(400).json({ error: `Ingresa ${type === 'imei' ? 'el IMEI 1' : 'el número de serie'}.` });
  if (type === 'imei' && !/^\d{14,16}$/.test(primary)) return res.status(400).json({ error: 'El IMEI 1 debe contener entre 14 y 16 dígitos.' });
  if (type === 'serial' && !/^[A-Za-z0-9._\-/ ]{3,50}$/.test(primary)) return res.status(400).json({ error: 'El número de serie no tiene un formato válido.' });
  if (secondary && (type !== 'imei' || !/^\d{14,16}$/.test(secondary))) return res.status(400).json({ error: 'El IMEI 2 debe contener entre 14 y 16 dígitos.' });

  const normalizedNew = [primary, secondary].filter(Boolean).map(value => value.toUpperCase());
  for (const otherOrder of orders) {
    for (const otherItem of (otherOrder.items || [])) {
      const sameLine = String(otherOrder.id) === orderId && otherItem === item;
      for (const entry of (otherItem.deviceIdentifiers || [])) {
        for (const value of [entry.primary, entry.secondary]) {
          if (!value) continue;
          if (sameLine && Number(entry.unit) === unit) continue;
          if (normalizedNew.includes(String(value).trim().toUpperCase())) {
            return res.status(409).json({ error: `La identificación “${value}” ya está registrada en otra unidad o pedido.` });
          }
        }
      }
    }
  }

  const previous = Array.isArray(item.deviceIdentifiers) ? item.deviceIdentifiers : [];
  const next = previous.filter(entry => Number(entry.unit) !== unit);
  next.push({ unit, type, primary, secondary: secondary || null });
  next.sort((a,b) => Number(a.unit) - Number(b.unit));
  item.deviceIdentifiers = next;
  order.updatedAt = new Date().toISOString();
  orders[orderIndex] = order;
  writeOrders(orders);
  auditLog(req, 'Serie/IMEI modificado', 'Series/IMEIS', {
    orderId: order.id, orderNumber: order.orderNumber, productId: item.productId, productName: item.name, unit,
    before: previous.find(entry => Number(entry.unit) === unit) || null,
    after: { unit, type, primary, secondary: secondary || null }
  });
  return res.json({ ok: true, row: collectRegisteredIdentifiers().find(row => String(row.orderId) === orderId && row.itemIndex === itemIndex && Number(row.unit) === unit) || null });
});


app.get('/api/admin/clientes', requireOrdersAccess, (req, res) => {
  const session = getSession(req);
  let customers = readCustomers();
  // Fallback inteligente: clientes históricos aunque todavía no exista customers.json.
  const allOrders = readOrders();
  let seededCustomers = false;
  for (const order of allOrders) {
    const source = order.customer || {};
    const identity = customerIdentity(source);
    if (!identity || identity === 'name:') continue;
    if (!customers.some(customer => customer.identity === identity)) {
      customers.push({ id: crypto.randomUUID(), identity, name: source.name || '', phone: source.phone || '', cedula: source.cedula || '', email: source.email || '', city: source.city || '', address: source.address || '', mapsUrl: source.mapsUrl || '', notes: source.notes || '', createdAt: order.createdAt || new Date().toISOString(), updatedAt: order.updatedAt || order.createdAt || new Date().toISOString() });
      seededCustomers = true;
    }
  }
  if (seededCustomers) { try { writeCustomers(customers); } catch {} }
  const q = cleanText(req.query?.q, 120).toLocaleLowerCase('es-EC');
  const sales = readSales();
  const rows = customers.map(customer => {
    const tx = customerTransactions(customer, allOrders, sales);
    const activeOrders = tx.filter(item => item.type === 'pedido' && item.status !== 'Cancelado').length;
    const sales = tx.filter(item => item.type === 'venta');
    return { ...customer, orderCount: tx.filter(item => item.type === 'pedido').length, activeOrderCount: activeOrders, salesCount: sales.length, salesTotal: sales.reduce((sum,item)=>sum+Number(item.total||0),0), lastActivityAt: tx[0]?.date || customer.updatedAt || customer.createdAt };
  }).filter(customer => !q || `${customer.name} ${customer.cedula} ${customer.phone} ${customer.email} ${customer.city}`.toLocaleLowerCase('es-EC').includes(q));
  if (String(session.role || '').toLowerCase() === 'vendedor') {
    // El vendedor solo consulta clientes que tengan pedidos asignados a su usuario.
    const assignedIds = new Set(allOrders.filter(order => String(order.assignedSellerId || '') === String(session.accountId || '')).map(order => customerIdentity(order.customer || {})));
    return res.json(rows.filter(row => assignedIds.has(row.identity)));
  }
  return res.json(rows);
});

app.get('/api/admin/clientes/:id', requireOrdersAccess, (req, res) => {
  const customer = readCustomers().find(item => String(item.id) === String(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const tx = customerTransactions(customer);
  return res.json({ customer, transactions: tx, totals: { orders: tx.filter(item=>item.type==='pedido').length, sales: tx.filter(item=>item.type==='venta').length, salesTotal: tx.filter(item=>item.type==='venta').reduce((sum,item)=>sum+Number(item.total||0),0) } });
});

app.post('/api/admin/clientes', requireOrdersAccess, (req, res) => {
  const body = req.body || {};
  const identity = customerIdentity(body);
  if (!body.name || !body.cedula) return res.status(400).json({ error: 'Nombre y cédula/RUC son obligatorios.' });
  const customers = readCustomers();
  const duplicate = customers.find(item => item.identity === identity);
  if (duplicate) return res.status(409).json({ error: 'Ya existe un cliente con esos datos.', customer: duplicate });
  const now = new Date().toISOString();
  const customer = { id: crypto.randomUUID(), identity, name: cleanText(body.name,120), phone: cleanText(body.phone,50), cedula: cleanText(body.cedula,20).replace(/\D/g,''), email: cleanText(body.email,160), city: cleanText(body.city,80), address: cleanText(body.address,240), mapsUrl: cleanText(body.mapsUrl,500), notes: cleanText(body.notes,1000), createdAt: now, updatedAt: now };
  customers.unshift(customer); writeCustomers(customers); auditLog(req,'Cliente creado','Clientes',{customerId:customer.id,identity:customer.identity});
  return res.status(201).json(customer);
});

app.put('/api/admin/clientes/:id', requireStoreManagerOrAdmin, (req, res) => {
  const customers = readCustomers();
  const index = customers.findIndex(item => String(item.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const current = customers[index]; const body = req.body || {};
  const updated = { ...current, name: cleanText(body.name ?? current.name,120), phone: cleanText(body.phone ?? current.phone,50), cedula: cleanText(body.cedula ?? current.cedula,20).replace(/\D/g,''), email: cleanText(body.email ?? current.email,160), city: cleanText(body.city ?? current.city,80), address: cleanText(body.address ?? current.address,240), mapsUrl: cleanText(body.mapsUrl ?? current.mapsUrl,500), notes: cleanText(body.notes ?? current.notes,1000), updatedAt: new Date().toISOString() };
  updated.identity = customerIdentity(updated);
  const duplicate = customers.find((item,i)=>i!==index && item.identity===updated.identity);
  if (duplicate) return res.status(409).json({ error: 'Los datos corresponden a otro cliente existente.' });
  customers[index] = updated; writeCustomers(customers); auditLog(req,'Cliente actualizado','Clientes',{customerId:updated.id,changes:auditDiff(current,updated,['name','phone','cedula','email','city','address','mapsUrl','notes'])});
  return res.json(updated);
});


app.get('/api/admin/compras', requireAdmin, (req,res)=>{
  return res.json(readPurchases().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)));
});

app.post('/api/admin/compras', requireAdmin, (req,res)=>{
  const body=req.body||{}; const supplier=cleanText(body.supplier,140); const note=cleanText(body.note,1000); const rawItems=Array.isArray(body.items)?body.items:[];
  if(!supplier) return res.status(400).json({error:'Ingresa el proveedor.'}); if(!rawItems.length) return res.status(400).json({error:'Agrega al menos un producto.'});
  const products=readProducts().map(normalizeProduct); const byId=new Map(products.map(p=>[String(p.id),p])); const items=[];
  for(const raw of rawItems){const product=byId.get(String(raw.productId||''));const quantity=Number.parseInt(raw.quantity,10);const unitCost=Number(raw.unitCost);if(!product||!Number.isInteger(quantity)||quantity<1||quantity>100000||!Number.isFinite(unitCost)||unitCost<0)return res.status(400).json({error:'Revisa los productos, cantidades y costos de la compra.'});items.push({productId:product.id,sku:product.sku||'',name:product.name,quantity,unitCost:Math.round(unitCost*100)/100,subtotal:Math.round(quantity*unitCost*100)/100});}
  const total=Math.round(items.reduce((sum,item)=>sum+item.subtotal,0)*100)/100; const purchases=readPurchases(); const now=new Date().toISOString();
  const purchase={id:crypto.randomUUID(),number:nextPurchaseNumber(purchases),supplier,items,total,note,status:'Borrador',stockApplied:false,createdAt:now,updatedAt:now,createdBy:getSession(req)?.accountId||null}; purchases.unshift(purchase); writePurchases(purchases); auditLog(req,'Compra creada','Compras',{purchaseId:purchase.id,number:purchase.number,supplier,total}); return res.status(201).json(purchase);
});

app.put('/api/admin/compras/:id', requireAdmin, (req,res)=>{
  const purchases=readPurchases(); const index=purchases.findIndex(row=>String(row.id)===String(req.params.id)); if(index<0)return res.status(404).json({error:'Compra no encontrada.'});
  const purchase=purchases[index]; const nextStatus=cleanText(req.body?.status,30); if(!['Borrador','Ordenada','Recibida','Cancelada'].includes(nextStatus))return res.status(400).json({error:'Estado de compra no válido.'});
  if(purchase.status==='Recibida' && nextStatus!=='Recibida')return res.status(409).json({error:'Una compra recibida no puede retroceder de estado.'});
  if(nextStatus==='Recibida' && !purchase.stockApplied){
    const products=readProducts().map(normalizeProduct); const byId=new Map(purchase.items.map(item=>[String(item.productId),item])); const before=products.map(p=>({...p}));
    const updated=products.map(product=>{const item=byId.get(String(product.id));if(!item)return product;return normalizeProduct({...product,stock:Number(product.stock||0)+Number(item.quantity||0),purchasePrice:Number(item.unitCost||product.purchasePrice||0),updatedAt:new Date().toISOString()});});
    writeProducts(updated); purchase.stockApplied=true; purchase.receivedAt=new Date().toISOString(); auditLog(req,'Compra recibida','Compras',{purchaseId:purchase.id,number:purchase.number,supplier:purchase.supplier,inventory:{synchronized:true,movements:auditStockMovementDiff(before,updated,`Recepción de compra ${purchase.number}`)}});
  }
  purchase.status=nextStatus; purchase.updatedAt=new Date().toISOString(); purchases[index]=purchase; writePurchases(purchases); auditLog(req,'Estado de compra actualizado','Compras',{purchaseId:purchase.id,number:purchase.number,status:nextStatus}); return res.json(purchase);
});

app.delete('/api/admin/compras/:id', requireAdmin, (req,res)=>{const purchases=readPurchases();const purchase=purchases.find(row=>String(row.id)===String(req.params.id));if(!purchase)return res.status(404).json({error:'Compra no encontrada.'});if(purchase.stockApplied||purchase.status==='Recibida')return res.status(409).json({error:'Una compra recibida no se puede eliminar desde aquí.'});writePurchases(purchases.filter(row=>String(row.id)!==String(req.params.id)));auditLog(req,'Compra eliminada','Compras',{purchaseId:purchase.id,number:purchase.number});return res.status(204).end();});

app.get('/api/admin/inventory-movements', requireAdmin, (req, res) => {
  const q = cleanText(req.query?.q, 120).toLocaleLowerCase('es-EC');
  const from = cleanText(req.query?.from, 10); const to = cleanText(req.query?.to, 10); const direction = cleanText(req.query?.direction, 20).toLowerCase();
  const rows = [];
  for (const entry of readAudit()) {
    const movements = entry?.details?.inventory?.movements;
    if (!Array.isArray(movements)) continue;
    for (const movement of movements) {
      const day = entry.createdAt ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil'}).format(new Date(entry.createdAt)) : '';
      if (from && day < from) continue; if (to && day > to) continue;
      if (direction && String(movement.direction||'').toLowerCase() !== direction) continue;
      const hay = `${movement.name||''} ${movement.sku||''} ${movement.reason||''} ${entry.action||''}`.toLocaleLowerCase('es-EC');
      if (q && !hay.includes(q)) continue;
      rows.push({ id:`${entry.id}-${movement.productId}`, date:entry.createdAt, action:entry.action, module:entry.module, user:entry.username || 'Sistema', productId:movement.productId, sku:movement.sku || '', name:movement.name || '', quantity:Number(movement.quantity||0), direction:movement.direction || '', before:Number(movement.before||0), after:Number(movement.after||0), reason:movement.reason || '' });
    }
  }
  rows.sort((a,b)=>new Date(b.date)-new Date(a.date));
  return res.json({ rows, total: rows.length });
});

app.put('/api/admin/inventory/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const index = products.findIndex(product => product.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Producto no encontrado.' });

  // Inventario compacto: este endpoint SOLO modifica los campos de inventario.
  // No vuelve a validar nombre, descripción, imágenes, SKU, etc.
  const previous = normalizeProduct(products[index]);
  const body = req.body || {};
  const purchasePrice = body.purchasePrice === '' || body.purchasePrice == null
    ? previous.purchasePrice : Number(body.purchasePrice);
  const stock = body.stock === '' || body.stock == null
    ? previous.stock : Number(body.stock);
  const salePrice = body.salePrice === '' || body.salePrice == null
    ? previous.salePrice : Number(body.salePrice);

  if (!Number.isFinite(purchasePrice) || purchasePrice < 0 || purchasePrice > 100000000) {
    return res.status(400).json({ error: 'El precio de compra no es válido.' });
  }
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000000) {
    return res.status(400).json({ error: 'El stock debe ser un número entero igual o mayor que 0.' });
  }
  if (!Number.isFinite(salePrice) || salePrice < 0 || salePrice > 100000000) {
    return res.status(400).json({ error: 'El precio de venta no es válido.' });
  }

  const updated = {
    ...previous,
    purchasePrice: Math.round(purchasePrice * 100) / 100,
    salePrice: Math.round(salePrice * 100) / 100,
    price: Math.round(salePrice * 100) / 100,
    stock,
    updatedAt: new Date().toISOString()
  };

  if (previous.category === 'cosplay') {
    if (body.rentalPrice !== undefined && body.rentalPrice !== null && body.rentalPrice !== '') {
      const rentalPrice = Number(body.rentalPrice);
      if (!Number.isFinite(rentalPrice) || rentalPrice < 0 || rentalPrice > 100000000) {
        return res.status(400).json({ error: 'El precio de alquiler no es válido.' });
      }
      updated.rentalPrice = Math.round(rentalPrice * 100) / 100;
    }
  } else {
    updated.rentalPrice = null;
  }

  products[index] = normalizeProduct(updated);
  writeProducts(products);
  const manualMovements = auditStockMovementDiff([previous], [products[index]], 'Ajuste manual de inventario');
  if (manualMovements.length || previous.purchasePrice !== products[index].purchasePrice || previous.salePrice !== products[index].salePrice) {
    auditLog(req, 'Inventario actualizado', 'Inventario', { productId: products[index].id, sku: products[index].sku, name: products[index].name, inventory: { synchronized: true, movements: manualMovements }, priceChange: auditDiff(previous, products[index], ['purchasePrice','salePrice','rentalPrice']) });
  }
  return res.json(products[index]);
});
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
  auditLog(req, 'Producto creado', 'Inventario', { productId: product.id, sku: product.sku, name: product.name, after: auditValue(product) });
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
  auditLog(req, 'Producto actualizado', 'Inventario', {
    productId: products[index].id,
    sku: products[index].sku,
    changes: auditDiff(previous, products[index], ['name','sku','category','stock','purchasePrice','salePrice','rentalPrice','published','description']),
    inventory: {
      synchronized: true,
      movements: Number(previous.stock || 0) !== Number(products[index].stock || 0)
        ? [{
            productId: products[index].id,
            sku: products[index].sku || '',
            name: products[index].name || '',
            quantity: Math.abs(Number(products[index].stock || 0) - Number(previous.stock || 0)),
            direction: Number(products[index].stock || 0) < Number(previous.stock || 0) ? 'salida' : 'entrada',
            before: Number(previous.stock || 0),
            after: Number(products[index].stock || 0),
            reason: 'Edición manual de inventario'
          }]
        : []
    }
  });
  return res.json(products[index]);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const product = products.find((item) => item.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });
  writeProducts(products.filter((item) => item.id !== req.params.id));
  (product.images || [product.image]).forEach(deleteUploadedImage);
  auditLog(req, 'Producto eliminado', 'Inventario', {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    inventory: {
      synchronized: true,
      removedFromCatalog: true,
      previousStock: Number(product.stock || 0)
    }
  });
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
