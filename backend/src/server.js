import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import helmet from 'helmet';
import nodemailer from 'nodemailer';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import swaggerUi from 'swagger-ui-express';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { pool, withTransaction } from './db.js';
import { runMigrations } from './migrate.js';
import { createAccessToken, hashToken, randomToken, requireAdmin, requireAuth } from './auth.js';
import { buildOpenApiSpec } from './openapi.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const debugEnabled = String(process.env.DEBUG || process.env.APP_DEBUG || '').toLowerCase() === 'true';
const swaggerEnabled = debugEnabled && String(process.env.SWAGGER_ENABLED ?? 'true').toLowerCase() === 'true';
const swaggerPath = process.env.SWAGGER_PATH || '/api/v1/docs';
const corsOrigins = String(process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
app.use(helmet({ contentSecurityPolicy: debugEnabled ? false : undefined }));
app.use(cors(corsOrigins.length ? { origin: corsOrigins, credentials: true } : undefined));
app.use(express.json({ limit: '25mb' }));

// Versionierte API für mobile Clients. Bestehende /api-Endpunkte bleiben kompatibel.
app.use((req, _res, next) => {
  if (req.url === '/api/v1') req.url = '/api';
  else if (req.url.startsWith('/api/v1/')) req.url = `/api/${req.url.slice('/api/v1/'.length)}`;
  next();
});

if (swaggerEnabled) {
  const openapi = buildOpenApiSpec();
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.get('/api/v1/openapi.json', (_req, res) => res.json(openapi));
  app.use(swaggerPath, swaggerUi.serve, swaggerUi.setup(openapi, {
    explorer: true,
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  }));
}

const btMacSchema = z.string().trim().regex(/^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/).transform(value => value.toUpperCase());
const vehicleSchema = z.object({ name: z.string().trim().min(1).max(100), licensePlate: z.string().trim().max(30).optional().nullable(), btMac: btMacSchema.optional().nullable() });
const vehicleBluetoothSchema = z.object({ btMac: btMacSchema.nullable() });
const tripPointSchema = z.object({ recordedAt: z.string().datetime(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), altitudeM: z.number().finite().optional().nullable(), speedKmh: z.number().nonnegative().optional().nullable(), accuracyM: z.number().nonnegative().optional().nullable(), sequenceNumber: z.number().int().nonnegative() });
const tripSchema = z.object({
  vehicleId: z.string().uuid(), tripType: z.enum(['commute', 'private', 'business']), startedAt: z.string().datetime(), endedAt: z.string().datetime().optional().nullable(),
  startLocation: z.string().trim().min(1).max(255), destinationLocation: z.string().trim().min(1).max(255),
  startLatitude: z.number().min(-90).max(90).optional().nullable(), startLongitude: z.number().min(-180).max(180).optional().nullable(),
  destinationLatitude: z.number().min(-90).max(90).optional().nullable(), destinationLongitude: z.number().min(-180).max(180).optional().nullable(),
  startOdometerKm: z.number().nonnegative().optional().nullable(), endOdometerKm: z.number().nonnegative().optional().nullable(), distanceKm: z.number().nonnegative().optional().nullable(),
  purpose: z.string().trim().max(255).optional().nullable(), notes: z.string().trim().max(2000).optional().nullable(), tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});

async function ensureDefaultAdmin() {
  const email = process.env.DEFAULT_ADMIN_EMAIL;
  const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  const displayName = process.env.DEFAULT_ADMIN_DISPLAYNAME || process.env.DEFAULT_ADMIN_NAME || 'Administrator';
  const mustChangePassword = String(process.env.FORCE_ADMIN_PASSWORD_CHANGE ?? 'true').toLowerCase() === 'true';
  if (!email || !password) throw new Error('DEFAULT_ADMIN_EMAIL und DEFAULT_ADMIN_PASSWORD fehlen');
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rowCount) return;
  await pool.query(
    'INSERT INTO users (email, username, password_hash, display_name, role, must_change_password) VALUES ($1,$2,$3,$4,$5,$6)',
    [email.toLowerCase(), username.toLowerCase(), await bcrypt.hash(password, 12), displayName, 'admin', mustChangePassword],
  );
}

async function issueTokens(user, device = 'Unbekanntes Gerät') {
  const metadata = typeof device === 'string' ? { deviceName: device } : device;
  const refreshToken = randomToken();
  const days = Math.max(1, Number(process.env.REFRESH_TOKEN_DAYS || 90));
  await pool.query(`INSERT INTO refresh_tokens (user_id, token_hash, device_name, device_id, platform, app_version, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,NOW()+($7 || ' days')::interval)`, [
      user.id, hashToken(refreshToken), (metadata.deviceName || 'Unbekanntes Gerät').slice(0, 120),
      metadata.deviceId?.slice(0, 160) || null, metadata.platform?.slice(0, 40) || null,
      metadata.appVersion?.slice(0, 40) || null, days,
    ]);
  return { accessToken: createAccessToken(user), refreshToken, tokenType: 'Bearer', expiresIn: 900 };
}

async function geocodeLocation(text) {
  if (!process.env.PHOTON_URL || !text) return null;
  try { const response = await fetch(`${process.env.PHOTON_URL.replace(/\/$/, '')}/api/?q=${encodeURIComponent(text)}&limit=1&lang=de`); if (!response.ok) return null; const coordinates = (await response.json()).features?.[0]?.geometry?.coordinates; return coordinates ? { longitude: coordinates[0], latitude: coordinates[1] } : null; } catch { return null; }
}

function publicUser(row) { return { id: row.id, email: row.email, username: row.username || null, displayName: row.display_name, role: row.role, isActive: row.is_active, mustChangePassword: Boolean(row.must_change_password), createdAt: row.created_at }; }

async function sendResetMail(email, token) {
  const protocol = process.env.APP_PROTOCOL || 'https';
  const url = `${protocol}://${process.env.APP_HOST}/?resetToken=${encodeURIComponent(token)}`;
  if (!process.env.SMTP_HOST) return { delivered: false, url };
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE) === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.DEFAULT_ADMIN_EMAIL, to: email, subject: 'Passwort für Fahrtenbuch zurücksetzen', text: `Öffne innerhalb von 30 Minuten diesen Link:\n${url}`, html: `<p>Öffne innerhalb von 30 Minuten diesen Link:</p><p><a href="${url}">Passwort zurücksetzen</a></p>` });
  return { delivered: true, url };
}


const rpID = process.env.WEBAUTHN_RP_ID || process.env.APP_HOST;
const rpName = process.env.WEBAUTHN_RP_NAME || 'Fahrtenbuch';
const expectedOrigin = process.env.WEBAUTHN_ORIGIN || `${process.env.APP_PROTOCOL || 'https'}://${process.env.APP_HOST}`;
function totpFor(secret, email) { return new OTPAuth.TOTP({ issuer: rpName, label: email, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }); }
async function getPendingLogin(loginToken) { return (await pool.query(`SELECT m.*,u.email,u.display_name,u.role,u.is_active,u.totp_secret,u.totp_enabled FROM mfa_login_challenges m JOIN users u ON u.id=m.user_id WHERE m.token_hash=$1 AND m.used_at IS NULL AND m.expires_at>NOW()`, [hashToken(loginToken)])).rows[0]; }
async function completeMfaLogin(challenge) { await pool.query('UPDATE mfa_login_challenges SET used_at=NOW() WHERE id=$1', [challenge.id]); const user={id:challenge.user_id,email:challenge.email,display_name:challenge.display_name,role:challenge.role,is_active:challenge.is_active}; return { ...(await issueTokens(user, challenge.device_name)), user: publicUser(user) }; }

app.post('/api/auth/mfa/totp', async (req,res)=>{
  const parsed=z.object({loginToken:z.string().min(20),code:z.string().regex(/^\d{6}$/)}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Ungültiger MFA-Code'});
  const challenge=await getPendingLogin(parsed.data.loginToken); if(!challenge||!challenge.is_active||!challenge.totp_enabled||!challenge.totp_secret)return res.status(401).json({error:'MFA-Anmeldung ist abgelaufen'});
  const delta=totpFor(challenge.totp_secret,challenge.email).validate({token:parsed.data.code,window:1}); if(delta===null)return res.status(401).json({error:'Authenticator-Code ist ungültig'});
  res.json(await completeMfaLogin(challenge));
});
app.post('/api/auth/mfa/passkey/options', async(req,res)=>{
  const parsed=z.object({loginToken:z.string().min(20)}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Login-Token fehlt'});
  const challenge=await getPendingLogin(parsed.data.loginToken); if(!challenge||!challenge.is_active)return res.status(401).json({error:'MFA-Anmeldung ist abgelaufen'});
  const credentials=(await pool.query('SELECT credential_id,transports FROM passkeys WHERE user_id=$1',[challenge.user_id])).rows;
  const options=await generateAuthenticationOptions({rpID,allowCredentials:credentials.map(x=>({id:x.credential_id,transports:x.transports||[]})),userVerification:'required'});
  await pool.query(`INSERT INTO webauthn_challenges(user_id,challenge,purpose,expires_at) VALUES($1,$2,'login',NOW()+INTERVAL '5 minutes')`,[challenge.user_id,options.challenge]);
  res.json(options);
});
app.post('/api/auth/mfa/passkey/verify', async(req,res)=>{
  const parsed=z.object({loginToken:z.string().min(20),response:z.any()}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Ungültige Passkey-Antwort'});
  const challenge=await getPendingLogin(parsed.data.loginToken); if(!challenge||!challenge.is_active)return res.status(401).json({error:'MFA-Anmeldung ist abgelaufen'});
  const saved=(await pool.query('SELECT * FROM passkeys WHERE user_id=$1 AND credential_id=$2',[challenge.user_id,parsed.data.response.id])).rows[0]; if(!saved)return res.status(401).json({error:'Passkey ist nicht registriert'});
  const webChallenge=(await pool.query(`SELECT * FROM webauthn_challenges WHERE user_id=$1 AND purpose='login' AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1`,[challenge.user_id])).rows[0]; if(!webChallenge)return res.status(401).json({error:'Passkey-Challenge ist abgelaufen'});
  const verification=await verifyAuthenticationResponse({response:parsed.data.response,expectedChallenge:webChallenge.challenge,expectedOrigin,expectedRPID:rpID,credential:{id:saved.credential_id,publicKey:Buffer.from(saved.public_key,'base64url'),counter:Number(saved.counter),transports:saved.transports||[]},requireUserVerification:true});
  if(!verification.verified)return res.status(401).json({error:'Passkey konnte nicht bestätigt werden'});
  await pool.query('UPDATE passkeys SET counter=$1,last_used_at=NOW() WHERE id=$2',[verification.authenticationInfo.newCounter,saved.id]);
  res.json(await completeMfaLogin(challenge));
});

app.get('/api/mfa/status', requireAuth, async(req,res)=>{const u=(await pool.query('SELECT totp_enabled FROM users WHERE id=$1',[req.user.id])).rows[0];const passkeys=(await pool.query(`SELECT id,name,created_at AS "createdAt",last_used_at AS "lastUsedAt" FROM passkeys WHERE user_id=$1 ORDER BY created_at`,[req.user.id])).rows;res.json({totpEnabled:Boolean(u?.totp_enabled),passkeys});});
app.post('/api/mfa/totp/setup', requireAuth, async(req,res)=>{const secret=new OTPAuth.Secret({size:20}).base32;const user=(await pool.query('SELECT email FROM users WHERE id=$1',[req.user.id])).rows[0];await pool.query('UPDATE users SET totp_secret=$1,totp_enabled=FALSE WHERE id=$2',[secret,req.user.id]);const uri=totpFor(secret,user.email).toString();res.json({secret,uri,qrCodeDataUrl:await QRCode.toDataURL(uri,{width:240,margin:1})});});
app.post('/api/mfa/totp/enable', requireAuth, async(req,res)=>{const parsed=z.object({code:z.string().regex(/^\d{6}$/)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Sechsstelligen Code eingeben'});const u=(await pool.query('SELECT email,totp_secret FROM users WHERE id=$1',[req.user.id])).rows[0];if(!u?.totp_secret||totpFor(u.totp_secret,u.email).validate({token:parsed.data.code,window:1})===null)return res.status(400).json({error:'Code ist ungültig'});await pool.query('UPDATE users SET totp_enabled=TRUE WHERE id=$1',[req.user.id]);res.json({enabled:true});});
app.delete('/api/mfa/totp', requireAuth, async(req,res)=>{await pool.query('UPDATE users SET totp_secret=NULL,totp_enabled=FALSE WHERE id=$1',[req.user.id]);res.status(204).end();});
app.post('/api/mfa/passkeys/options', requireAuth, async(req,res)=>{const user=(await pool.query('SELECT id,email,display_name FROM users WHERE id=$1',[req.user.id])).rows[0];const existing=(await pool.query('SELECT credential_id,transports FROM passkeys WHERE user_id=$1',[req.user.id])).rows;const options=await generateRegistrationOptions({rpName,rpID,userName:user.email,userDisplayName:user.display_name,attestationType:'none',excludeCredentials:existing.map(x=>({id:x.credential_id,transports:x.transports||[]})),authenticatorSelection:{residentKey:'required',userVerification:'required'}});await pool.query(`INSERT INTO webauthn_challenges(user_id,challenge,purpose,expires_at) VALUES($1,$2,'register',NOW()+INTERVAL '5 minutes')`,[req.user.id,options.challenge]);res.json(options);});
app.post('/api/mfa/passkeys/verify', requireAuth, async(req,res)=>{const parsed=z.object({name:z.string().trim().min(1).max(80).default('Passkey'),response:z.any()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Ungültige Passkey-Antwort'});const ch=(await pool.query(`SELECT * FROM webauthn_challenges WHERE user_id=$1 AND purpose='register' AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1`,[req.user.id])).rows[0];if(!ch)return res.status(400).json({error:'Passkey-Challenge ist abgelaufen'});const verification=await verifyRegistrationResponse({response:parsed.data.response,expectedChallenge:ch.challenge,expectedOrigin,expectedRPID:rpID,requireUserVerification:true});if(!verification.verified||!verification.registrationInfo)return res.status(400).json({error:'Passkey konnte nicht registriert werden'});const info=verification.registrationInfo;await pool.query(`INSERT INTO passkeys(user_id,credential_id,public_key,counter,transports,device_type,backed_up,name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[req.user.id,info.credential.id,Buffer.from(info.credential.publicKey).toString('base64url'),info.credential.counter,info.credential.transports||[],info.credentialDeviceType,info.credentialBackedUp,parsed.data.name]);res.status(201).json({registered:true});});
app.delete('/api/mfa/passkeys/:id', requireAuth, async(req,res)=>{const r=await pool.query('DELETE FROM passkeys WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Passkey nicht gefunden'});res.status(204).end();});

app.post('/api/auth/passkey/options', async (req,res)=>{
  const parsed=z.object({deviceName:z.string().trim().max(120).optional()}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:'Ungültige Anfrage'});
  const options=await generateAuthenticationOptions({rpID,userVerification:'required'});
  await pool.query(`INSERT INTO webauthn_challenges(user_id,challenge,purpose,device_name,expires_at) VALUES(NULL,$1,'passwordless-login',$2,NOW()+INTERVAL '5 minutes')`,[options.challenge,(parsed.data.deviceName||req.get('user-agent')||'Webbrowser').slice(0,120)]);
  res.json(options);
});
app.post('/api/auth/passkey/verify', async (req,res)=>{
  const parsed=z.object({challenge:z.string().min(20),response:z.any()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Ungültige Passkey-Antwort'});
  const saved=(await pool.query(`SELECT p.*,u.email,u.display_name,u.role,u.is_active FROM passkeys p JOIN users u ON u.id=p.user_id WHERE p.credential_id=$1`,[parsed.data.response.id])).rows[0];
  if(!saved||!saved.is_active)return res.status(401).json({error:'Passkey ist nicht registriert oder das Konto ist deaktiviert'});
  const webChallenge=(await pool.query(`SELECT * FROM webauthn_challenges WHERE purpose='passwordless-login' AND challenge=$1 AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1`,[parsed.data.challenge])).rows[0];
  if(!webChallenge)return res.status(401).json({error:'Passkey-Challenge ist abgelaufen'});
  const verification=await verifyAuthenticationResponse({response:parsed.data.response,expectedChallenge:webChallenge.challenge,expectedOrigin,expectedRPID:rpID,credential:{id:saved.credential_id,publicKey:Buffer.from(saved.public_key,'base64url'),counter:Number(saved.counter),transports:saved.transports||[]},requireUserVerification:true});
  if(!verification.verified)return res.status(401).json({error:'Passkey konnte nicht bestätigt werden'});
  await withTransaction(async c=>{await c.query('UPDATE passkeys SET counter=$1,last_used_at=NOW() WHERE id=$2',[verification.authenticationInfo.newCounter,saved.id]);await c.query('DELETE FROM webauthn_challenges WHERE id=$1',[webChallenge.id]);});
  const user={id:saved.user_id,email:saved.email,display_name:saved.display_name,role:saved.role,is_active:saved.is_active};
  res.json({...(await issueTokens(user,webChallenge.device_name||'Passkey')),user:publicUser(user)});
});

app.get('/api/health', async (_req, res) => { const db = await pool.query('SELECT NOW() AS now'); res.json({ status: 'ok', database: 'connected', time: db.rows[0].now, host: process.env.APP_HOST || null, photonConfigured: Boolean(process.env.PHOTON_URL), smtpConfigured: Boolean(process.env.SMTP_HOST) }); });

const readMetadataFile = (name, fallback) => { try { return fs.readFileSync(path.resolve(__dirname, `../${name}`), 'utf8').trim() || fallback; } catch { return fallback; } };
app.get('/api/system/version', (_req, res) => res.json({ version: readMetadataFile('VERSION', 'dev') }));
app.get('/api/config/services', (_req, res) => res.json({
  map: { provider: process.env.MAP_PROVIDER || 'maplibre', tileUrl: process.env.MAP_TILE_URL || null },
  photonConfigured: Boolean(process.env.PHOTON_URL),
  overpassConfigured: Boolean(process.env.OVERPASS_URL),
}));

app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1), totpCode: z.string().regex(/^\d{6}$/).optional().or(z.literal('')), deviceName: z.string().trim().max(120).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Ungültige Anmeldedaten' });
  const user = (await pool.query('SELECT * FROM users WHERE email=$1', [parsed.data.email.toLowerCase()])).rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'E-Mail oder Passwort ist falsch' });
  if (user.totp_enabled) {
    if (!parsed.data.totpCode) return res.status(401).json({ error: 'Authenticator-Code erforderlich', totpRequired: true });
    if (!user.totp_secret || totpFor(user.totp_secret,user.email).validate({token:parsed.data.totpCode,window:1})===null) return res.status(401).json({ error: 'Authenticator-Code ist ungültig', totpRequired: true });
  }
  res.json({ ...(await issueTokens(user, parsed.data.deviceName || req.get('user-agent') || 'Webbrowser')), user: publicUser(user) });
});


// Kurzlebige, einmalig verwendbare Anmeldung einer mobilen App per QR-Code.
app.post('/api/auth/pair/options', requireAuth, async (req, res) => {
  const parsed = z.object({ expiresIn: z.number().int().min(60).max(600).default(300) }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Die Gültigkeit muss zwischen 60 und 600 Sekunden liegen' });
  const pairToken = randomToken(32);
  const result = await pool.query(`INSERT INTO app_pairings(user_id,token_hash,expires_at)
    VALUES($1,$2,NOW()+($3 || ' seconds')::interval)
    RETURNING id,expires_at AS "expiresAt"`, [req.user.id, hashToken(pairToken), parsed.data.expiresIn]);
  const pair = result.rows[0];
  const serverUrl = `${process.env.APP_PROTOCOL || 'https'}://${process.env.APP_HOST}`;
  const currentUser = (await pool.query('SELECT username,email FROM users WHERE id=$1', [req.user.id])).rows[0];
  const qrPayload = { version: 1, type: 'pair', server: serverUrl, pairId: pair.id, pairToken, username: currentUser?.username || null, email: currentUser?.email || null, expiresAt: pair.expiresAt };
  res.status(201).json({ pairId: pair.id, pairToken, expiresAt: pair.expiresAt, qrPayload, qrCodeDataUrl: await QRCode.toDataURL(JSON.stringify(qrPayload), { width: 320, margin: 2 }) });
});

app.post('/api/auth/pair', async (req, res) => {
  const parsed = z.object({
    pairId: z.string().uuid(), pairToken: z.string().min(20),
    deviceName: z.string().trim().min(1).max(120), deviceId: z.string().trim().min(1).max(160),
    platform: z.string().trim().min(1).max(40).default('android'), appVersion: z.string().trim().max(40).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Ungültige Pairing-Daten', details: parsed.error.flatten() });
  const pairing = (await pool.query(`SELECT p.*,u.email,u.display_name,u.role,u.is_active
    FROM app_pairings p JOIN users u ON u.id=p.user_id WHERE p.id=$1`, [parsed.data.pairId])).rows[0];
  if (!pairing || pairing.token_hash !== hashToken(parsed.data.pairToken)) return res.status(401).json({ error: 'Pairing-Code ist ungültig' });
  if (pairing.status !== 'pending') return res.status(409).json({ error: `Pairing-Code ist bereits ${pairing.status}` });
  if (new Date(pairing.expires_at) <= new Date()) { await pool.query(`UPDATE app_pairings SET status='expired' WHERE id=$1`, [pairing.id]); return res.status(410).json({ error: 'Pairing-Code ist abgelaufen' }); }
  if (!pairing.is_active) return res.status(403).json({ error: 'Benutzerkonto ist deaktiviert' });
  const user = { id: pairing.user_id, email: pairing.email, display_name: pairing.display_name, role: pairing.role, is_active: pairing.is_active };
  const tokens = await withTransaction(async c => {
    const claimed = await c.query(`UPDATE app_pairings SET status='completed',completed_at=NOW(),device_id=$1,device_name=$2,platform=$3,app_version=$4
      WHERE id=$5 AND status='pending' AND expires_at>NOW() RETURNING id`, [parsed.data.deviceId, parsed.data.deviceName, parsed.data.platform, parsed.data.appVersion || null, pairing.id]);
    if (!claimed.rowCount) throw Object.assign(new Error('Pairing-Code wurde bereits verwendet oder ist abgelaufen'), { status: 409 });
    return issueTokens(user, parsed.data);
  });
  res.json({ ...tokens, user: publicUser(user), device: { id: parsed.data.deviceId, name: parsed.data.deviceName, platform: parsed.data.platform, appVersion: parsed.data.appVersion || null } });
});

app.get('/api/auth/pair/:pairId/status', requireAuth, async (req, res) => {
  const pair = (await pool.query(`SELECT id,status,expires_at AS "expiresAt",completed_at AS "completedAt",device_id AS "deviceId",device_name AS "deviceName",platform,app_version AS "appVersion"
    FROM app_pairings WHERE id=$1 AND user_id=$2`, [req.params.pairId, req.user.id])).rows[0];
  if (!pair) return res.status(404).json({ error: 'Pairing-Code nicht gefunden' });
  if (pair.status === 'pending' && new Date(pair.expiresAt) <= new Date()) { pair.status = 'expired'; await pool.query(`UPDATE app_pairings SET status='expired' WHERE id=$1`, [pair.id]); }
  res.json({ status: pair.status, expiresAt: pair.expiresAt, completedAt: pair.completedAt, device: pair.deviceId ? { id: pair.deviceId, name: pair.deviceName, platform: pair.platform, appVersion: pair.appVersion } : null });
});

app.delete('/api/auth/pair/:pairId', requireAuth, async (req, res) => {
  const result = await pool.query(`UPDATE app_pairings SET status='cancelled',cancelled_at=NOW()
    WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id`, [req.params.pairId, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Aktiver Pairing-Code nicht gefunden' });
  res.status(204).end();
});

app.post('/api/auth/refresh', async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().min(20) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Refresh-Token fehlt' });
  const result = await pool.query(`SELECT rt.*,u.email,u.display_name,u.role,u.is_active FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at>NOW()`, [hashToken(parsed.data.refreshToken)]);
  const session = result.rows[0]; if (!session || !session.is_active) return res.status(401).json({ error: 'Sitzung ist abgelaufen oder widerrufen' });
  await pool.query('UPDATE refresh_tokens SET last_used_at=NOW() WHERE id=$1', [session.id]);
  res.json({ accessToken: createAccessToken({ id: session.user_id, email: session.email, role: session.role }), tokenType: 'Bearer', expiresIn: 900 });
});

app.post('/api/auth/logout', async (req, res) => { const token = String(req.body?.refreshToken || ''); if (token) await pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1', [hashToken(token)]); res.status(204).end(); });
app.post('/api/auth/forgot-password', async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  const user = (await pool.query('SELECT id,email FROM users WHERE email=$1 AND is_active=TRUE', [parsed.data.email.toLowerCase()])).rows[0];
  let developmentResetUrl = null;
  if (user) { const token = randomToken(32); await pool.query(`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 minutes')`, [user.id, hashToken(token)]); const sent = await sendResetMail(user.email, token); if (!sent.delivered && String(process.env.PASSWORD_RESET_RETURN_LINK) === 'true') developmentResetUrl = sent.url; }
  res.json({ message: 'Falls ein aktives Konto existiert, wurde ein Link zum Zurücksetzen erstellt.', developmentResetUrl });
});
app.post('/api/auth/reset-password', async (req, res) => {
  const parsed = z.object({ token: z.string().min(20), password: z.string().min(10).max(200) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Token oder Passwort ist ungültig. Das Passwort muss mindestens 10 Zeichen haben.' });
  const result = await pool.query(`SELECT prt.id,prt.user_id FROM password_reset_tokens prt WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW()`, [hashToken(parsed.data.token)]); const reset = result.rows[0]; if (!reset) return res.status(400).json({ error: 'Der Link ist ungültig oder abgelaufen' });
  await withTransaction(async c => { await c.query('UPDATE users SET password_hash=$1,must_change_password=FALSE,updated_at=NOW() WHERE id=$2', [await bcrypt.hash(parsed.data.password,12), reset.user_id]); await c.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1', [reset.id]); await c.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [reset.user_id]); });
  res.json({ message: 'Passwort wurde geändert. Bitte neu anmelden.' });
});

app.get('/api/me', requireAuth, async (req,res) => { const user=(await pool.query('SELECT id,email,display_name,role,is_active,created_at FROM users WHERE id=$1 AND is_active=TRUE',[req.user.id])).rows[0]; if(!user)return res.status(401).json({error:'Konto ist deaktiviert'}); res.json(publicUser(user)); });
app.get('/api/sessions', requireAuth, async (req,res)=>{ const r=await pool.query(`SELECT id,device_name AS "deviceName",created_at AS "createdAt",last_used_at AS "lastUsedAt",expires_at AS "expiresAt" FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC`,[req.user.id]);res.json(r.rows);});
app.delete('/api/sessions/:id', requireAuth, async(req,res)=>{await pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.status(204).end();});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req,res)=>{ const r=await pool.query(`SELECT u.id,u.email,u.display_name AS "displayName",u.role,u.is_active AS "isActive",u.created_at AS "createdAt",COUNT(DISTINCT v.id)::int AS "vehicleCount",COUNT(DISTINCT t.id)::int AS "tripCount" FROM users u LEFT JOIN vehicles v ON v.user_id=u.id LEFT JOIN trips t ON t.user_id=u.id GROUP BY u.id ORDER BY u.created_at`);res.json(r.rows);});
app.post('/api/admin/users', requireAuth, requireAdmin, async(req,res)=>{ const p=z.object({email:z.string().email(),displayName:z.string().trim().min(1).max(100),password:z.string().min(10).max(200),role:z.enum(['admin','user'])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige Benutzerdaten'});try{const r=await pool.query(`INSERT INTO users(email,password_hash,display_name,role) VALUES($1,$2,$3,$4) RETURNING *`,[p.data.email.toLowerCase(),await bcrypt.hash(p.data.password,12),p.data.displayName,p.data.role]);res.status(201).json(publicUser(r.rows[0]));}catch(e){if(e.code==='23505')return res.status(409).json({error:'E-Mail-Adresse ist bereits vergeben'});throw e;}});
app.put('/api/admin/users/:id', requireAuth, requireAdmin, async(req,res)=>{ const p=z.object({displayName:z.string().trim().min(1).max(100),role:z.enum(['admin','user']),isActive:z.boolean(),password:z.string().min(10).max(200).optional().or(z.literal(''))}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige Benutzerdaten'});const current=(await pool.query('SELECT role FROM users WHERE id=$1',[req.params.id])).rows[0];if(!current)return res.status(404).json({error:'Benutzer nicht gefunden'});if(current.role==='admin'&&(p.data.role!=='admin'||!p.data.isActive)){const count=Number((await pool.query(`SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=TRUE`)).rows[0].count);if(count<=1)return res.status(409).json({error:'Der letzte aktive Administrator kann nicht deaktiviert oder herabgestuft werden'});} const values=[p.data.displayName,p.data.role,p.data.isActive,req.params.id];let sql='UPDATE users SET display_name=$1,role=$2,is_active=$3,updated_at=NOW()';if(p.data.password){values.splice(3,0,await bcrypt.hash(p.data.password,12));sql+=',password_hash=$4 WHERE id=$5 RETURNING *';}else sql+=' WHERE id=$4 RETURNING *';const r=await pool.query(sql,values);if(!p.data.isActive)await pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[req.params.id]);res.json(publicUser(r.rows[0]));});
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async(req,res)=>{if(req.params.id===req.user.id)return res.status(409).json({error:'Das eigene Konto kann nicht gelöscht werden'});const target=(await pool.query('SELECT role,is_active FROM users WHERE id=$1',[req.params.id])).rows[0];if(!target)return res.status(404).json({error:'Benutzer nicht gefunden'});if(target.role==='admin'&&target.is_active){const count=Number((await pool.query(`SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=TRUE`)).rows[0].count);if(count<=1)return res.status(409).json({error:'Der letzte aktive Administrator kann nicht gelöscht werden'});}await pool.query('DELETE FROM users WHERE id=$1',[req.params.id]);res.status(204).end();});

app.get('/api/vehicles', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT id,name,license_plate AS "licensePlate",bt_mac AS "btMac",bt_mac_updated_at AS "btMacUpdatedAt",created_at AS "createdAt" FROM vehicles WHERE user_id=$1 ORDER BY name`,[req.user.id]);res.json(r.rows);});
app.post('/api/vehicles', requireAuth, async(req,res)=>{const p=vehicleSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige Fahrzeugdaten'});const r=await pool.query(`INSERT INTO vehicles(user_id,name,license_plate,bt_mac,bt_mac_updated_at) VALUES($1,$2,NULLIF($3,''),$4,CASE WHEN $4 IS NULL THEN NULL ELSE NOW() END) RETURNING id,name,license_plate AS "licensePlate",bt_mac AS "btMac",bt_mac_updated_at AS "btMacUpdatedAt",created_at AS "createdAt"`,[req.user.id,p.data.name,p.data.licensePlate||'',p.data.btMac||null]);res.status(201).json(r.rows[0]);});
app.delete('/api/vehicles/:id', requireAuth, async(req,res)=>{try{const r=await pool.query('DELETE FROM vehicles WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Fahrzeug nicht gefunden'});res.status(204).end();}catch(e){if(e.code==='23503')return res.status(409).json({error:'Fahrzeug wird noch von Fahrten verwendet'});throw e;}});

app.get('/api/trips', requireAuth, async(req,res)=>{
  const values=[req.user.id];
  const where=['t.user_id=$1'];
  const add=(sql,value)=>{values.push(value);where.push(sql.replace('?',`$${values.length}`));};
  if(req.query.vehicleId)add('t.vehicle_id=?',String(req.query.vehicleId));
  if(req.query.from)add('t.started_at>=?',String(req.query.from));
  if(req.query.to)add('t.started_at<=?',String(req.query.to));
  if(req.query.type)add('t.trip_type=?',String(req.query.type));
  if(req.query.tag)add('EXISTS(SELECT 1 FROM trip_tags ftt JOIN tags ft ON ft.id=ftt.tag_id WHERE ftt.trip_id=t.id AND ft.name=?)',String(req.query.tag).toLowerCase());
  const r=await pool.query(`SELECT t.id,t.vehicle_id AS "vehicleId",v.name AS "vehicleName",v.license_plate AS "licensePlate",t.trip_type AS "tripType",t.tracking_status AS "trackingStatus",t.started_at AS "startedAt",t.ended_at AS "endedAt",t.start_location AS "startLocation",t.destination_location AS "destinationLocation",t.start_latitude AS "startLatitude",t.start_longitude AS "startLongitude",t.destination_latitude AS "destinationLatitude",t.destination_longitude AS "destinationLongitude",(SELECT COUNT(*)::int FROM trip_points p WHERE p.trip_id=t.id) AS "pointCount",t.start_odometer_km::float AS "startOdometerKm",t.end_odometer_km::float AS "endOdometerKm",t.distance_km::float AS "distanceKm",t.purpose,t.notes,COALESCE(array_agg(tag.name ORDER BY tag.name) FILTER(WHERE tag.id IS NOT NULL),'{}') AS tags FROM trips t JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN trip_tags tt ON tt.trip_id=t.id LEFT JOIN tags tag ON tag.id=tt.tag_id WHERE ${where.join(' AND ')} GROUP BY t.id,v.id ORDER BY t.started_at DESC`,values);
  res.json(r.rows);
});
app.post('/api/trips', requireAuth, async(req,res)=>{const p=tripSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige Fahrtdaten',details:p.error.flatten()});const trip=await withTransaction(async c=>{const vehicle=await c.query('SELECT id FROM vehicles WHERE id=$1 AND user_id=$2',[p.data.vehicleId,req.user.id]);if(!vehicle.rowCount){const e=new Error('Fahrzeug nicht gefunden');e.status=404;throw e;}const d=p.data;const [sg,dg]=await Promise.all([d.startLatitude==null?geocodeLocation(d.startLocation):null,d.destinationLatitude==null?geocodeLocation(d.destinationLocation):null]);const ins=await c.query(`INSERT INTO trips(user_id,vehicle_id,trip_type,started_at,ended_at,start_location,destination_location,start_latitude,start_longitude,destination_latitude,destination_longitude,start_odometer_km,end_odometer_km,distance_km,purpose,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,[req.user.id,d.vehicleId,d.tripType,d.startedAt,d.endedAt,d.startLocation,d.destinationLocation,d.startLatitude??sg?.latitude??null,d.startLongitude??sg?.longitude??null,d.destinationLatitude??dg?.latitude??null,d.destinationLongitude??dg?.longitude??null,d.startOdometerKm,d.endOdometerKm,d.distanceKm,d.purpose,d.notes]);for(const name of [...new Set(d.tags.map(x=>x.toLowerCase()))]){const tag=await c.query(`INSERT INTO tags(user_id,name) VALUES($1,$2) ON CONFLICT(user_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[req.user.id,name]);await c.query('INSERT INTO trip_tags(trip_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[ins.rows[0].id,tag.rows[0].id]);}return ins.rows[0];});res.status(201).json(trip);});
app.get('/api/trips/:id/points', requireAuth, async(req,res)=>{if(!(await pool.query('SELECT id FROM trips WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rowCount)return res.status(404).json({error:'Fahrt nicht gefunden'});const r=await pool.query(`SELECT recorded_at AS "recordedAt",latitude,longitude,altitude_m AS "altitudeM",speed_kmh AS "speedKmh",accuracy_m AS "accuracyM",sequence_number AS "sequenceNumber" FROM trip_points WHERE trip_id=$1 ORDER BY sequence_number`,[req.params.id]);res.json(r.rows);});
app.post('/api/trips/:id/points', requireAuth, async(req,res)=>{const p=z.object({points:z.array(tripPointSchema).min(1).max(5000)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige GPS-Punkte'});const count=await withTransaction(async c=>{if(!(await c.query('SELECT id FROM trips WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id])).rowCount){const e=new Error('Fahrt nicht gefunden');e.status=404;throw e;}for(const x of p.data.points)await c.query(`INSERT INTO trip_points(trip_id,recorded_at,latitude,longitude,altitude_m,speed_kmh,accuracy_m,sequence_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(trip_id,sequence_number) DO UPDATE SET recorded_at=EXCLUDED.recorded_at,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,altitude_m=EXCLUDED.altitude_m,speed_kmh=EXCLUDED.speed_kmh,accuracy_m=EXCLUDED.accuracy_m`,[req.params.id,x.recordedAt,x.latitude,x.longitude,x.altitudeM,x.speedKmh,x.accuracyM,x.sequenceNumber]);return Number((await c.query('SELECT COUNT(*) FROM trip_points WHERE trip_id=$1',[req.params.id])).rows[0].count);});res.status(201).json({stored:p.data.points.length,total:count});});
app.delete('/api/trips/:id', requireAuth, async(req,res)=>{const r=await pool.query('DELETE FROM trips WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Fahrt nicht gefunden'});res.status(204).end();});
app.get('/api/tags', requireAuth, async(req,res)=>{res.json((await pool.query('SELECT id,name FROM tags WHERE user_id=$1 ORDER BY name',[req.user.id])).rows);});

async function buildExport(userId){const user=(await pool.query('SELECT id,email,display_name,role,created_at FROM users WHERE id=$1',[userId])).rows[0];if(!user)throw Object.assign(new Error('Benutzer nicht gefunden'),{status:404});const vehicles=(await pool.query(`SELECT id,name,license_plate AS "licensePlate",bt_mac AS "btMac",bt_mac_updated_at AS "btMacUpdatedAt",created_at AS "createdAt" FROM vehicles WHERE user_id=$1 ORDER BY created_at`,[userId])).rows;const trips=(await pool.query(`SELECT t.*,COALESCE(array_agg(tag.name) FILTER(WHERE tag.id IS NOT NULL),'{}') tags FROM trips t LEFT JOIN trip_tags tt ON tt.trip_id=t.id LEFT JOIN tags tag ON tag.id=tt.tag_id WHERE t.user_id=$1 GROUP BY t.id ORDER BY t.started_at`,[userId])).rows;for(const t of trips)t.points=(await pool.query(`SELECT recorded_at AS "recordedAt",latitude,longitude,altitude_m AS "altitudeM",speed_kmh AS "speedKmh",accuracy_m AS "accuracyM",sequence_number AS "sequenceNumber" FROM trip_points WHERE trip_id=$1 ORDER BY sequence_number`,[t.id])).rows;return {format:'fahrtenbuch-export',version:1,exportedAt:new Date().toISOString(),user:{email:user.email,displayName:user.display_name},vehicles,trips};}
app.get('/api/export', requireAuth, async(req,res)=>res.json(await buildExport(req.user.id)));
app.get('/api/admin/users/:id/export', requireAuth, requireAdmin, async(req,res)=>res.json(await buildExport(req.params.id)));
async function importData(userId,data){if(data?.format!=='fahrtenbuch-export'||!Array.isArray(data.vehicles)||!Array.isArray(data.trips))throw Object.assign(new Error('Ungültiges Exportformat'),{status:400});return withTransaction(async c=>{const vehicleMap=new Map();for(const v of data.vehicles){const r=await c.query(`INSERT INTO vehicles(user_id,name,license_plate,bt_mac,bt_mac_updated_at) VALUES($1,$2,$3,$4,CASE WHEN $4 IS NULL THEN NULL ELSE NOW() END) RETURNING id`,[userId,String(v.name||'Importiertes Fahrzeug').slice(0,100),v.licensePlate||null,v.btMac||null]);vehicleMap.set(v.id,r.rows[0].id);}let importedTrips=0,importedPoints=0;for(const t of data.trips){const vehicleId=vehicleMap.get(t.vehicle_id||t.vehicleId);if(!vehicleId)continue;const r=await c.query(`INSERT INTO trips(user_id,vehicle_id,trip_type,started_at,ended_at,start_location,destination_location,start_latitude,start_longitude,destination_latitude,destination_longitude,start_odometer_km,end_odometer_km,distance_km,purpose,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,[userId,vehicleId,['commute','private','business'].includes(t.trip_type||t.tripType)?(t.trip_type||t.tripType):'private',t.started_at||t.startedAt||new Date().toISOString(),t.ended_at||t.endedAt||null,t.start_location||t.startLocation||'Unbekannt',t.destination_location||t.destinationLocation||'Unbekannt',t.start_latitude??t.startLatitude??null,t.start_longitude??t.startLongitude??null,t.destination_latitude??t.destinationLatitude??null,t.destination_longitude??t.destinationLongitude??null,t.start_odometer_km??t.startOdometerKm??null,t.end_odometer_km??t.endOdometerKm??null,t.distance_km??t.distanceKm??null,t.purpose||null,t.notes||null]);for(const name of (t.tags||[])){const tag=await c.query(`INSERT INTO tags(user_id,name) VALUES($1,$2) ON CONFLICT(user_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[userId,String(name).toLowerCase().slice(0,50)]);await c.query('INSERT INTO trip_tags(trip_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.rows[0].id,tag.rows[0].id]);}for(const [i,x] of (t.points||[]).entries()){await c.query(`INSERT INTO trip_points(trip_id,recorded_at,latitude,longitude,altitude_m,speed_kmh,accuracy_m,sequence_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[r.rows[0].id,x.recordedAt||x.recorded_at||new Date().toISOString(),x.latitude,x.longitude,x.altitudeM??x.altitude_m??null,x.speedKmh??x.speed_kmh??null,x.accuracyM??x.accuracy_m??null,x.sequenceNumber??x.sequence_number??i]);importedPoints++;}importedTrips++;}return {vehicles:vehicleMap.size,trips:importedTrips,points:importedPoints};});}
app.post('/api/import', requireAuth, async(req,res)=>res.status(201).json(await importData(req.user.id,req.body)));
app.post('/api/admin/users/:id/import', requireAuth, requireAdmin, async(req,res)=>res.status(201).json(await importData(req.params.id,req.body)));



// Android-/REST-Erweiterungen -------------------------------------------------
app.get('/api/users/me', requireAuth, async(req,res)=>{
  const user=(await pool.query('SELECT id,email,display_name,role,is_active,created_at FROM users WHERE id=$1 AND is_active=TRUE',[req.user.id])).rows[0];
  if(!user)return res.status(401).json({error:'Konto ist deaktiviert'});
  res.json(publicUser(user));
});
app.put('/api/users/me', requireAuth, async(req,res)=>{
  const parsed=z.object({displayName:z.string().trim().min(1).max(100),email:z.string().email().optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Ungültige Profildaten'});
  try{
    const r=await pool.query(`UPDATE users SET display_name=$1,email=COALESCE($2,email),updated_at=NOW() WHERE id=$3 RETURNING id,email,display_name,role,is_active,created_at`,[parsed.data.displayName,parsed.data.email?.toLowerCase()||null,req.user.id]);
    res.json(publicUser(r.rows[0]));
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'E-Mail-Adresse ist bereits vergeben'});throw e;}
});
app.get('/api/users/me/sessions', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT id,device_name AS "deviceName",created_at AS "createdAt",last_used_at AS "lastUsedAt",expires_at AS "expiresAt" FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC`,[req.user.id]);res.json(r.rows);});
app.delete('/api/users/me/sessions/:id', requireAuth, async(req,res)=>{await pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.status(204).end();});
app.get('/api/users/me/devices', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT COALESCE(device_id,id::text) AS id,device_name AS name,platform,app_version AS "appVersion",MIN(created_at) AS "createdAt",MAX(last_used_at) AS "lastSeenAt",COUNT(*)::int AS "sessionCount" FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() GROUP BY COALESCE(device_id,id::text),device_name,platform,app_version ORDER BY MAX(COALESCE(last_used_at,created_at)) DESC`,[req.user.id]);res.json(r.rows);});
app.delete('/api/users/me/devices/:deviceId', requireAuth, async(req,res)=>{const r=await pool.query(`UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL AND (device_id=$2 OR (device_id IS NULL AND id::text=$2))`,[req.user.id,req.params.deviceId]);if(!r.rowCount)return res.status(404).json({error:'Gerät nicht gefunden'});res.status(204).end();});

app.get('/api/vehicles/:id', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT id,name,license_plate AS "licensePlate",bt_mac AS "btMac",bt_mac_updated_at AS "btMacUpdatedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM vehicles WHERE id=$1 AND user_id=$2`,[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Fahrzeug nicht gefunden'});res.json(r.rows[0]);});
app.put('/api/vehicles/:id', requireAuth, async(req,res)=>{const p=vehicleSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige Fahrzeugdaten'});const r=await pool.query(`UPDATE vehicles SET name=$1,license_plate=NULLIF($2,''),bt_mac=$3,bt_mac_updated_at=CASE WHEN bt_mac IS DISTINCT FROM $3 THEN NOW() ELSE bt_mac_updated_at END,updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING id,name,license_plate AS "licensePlate",bt_mac AS "btMac",bt_mac_updated_at AS "btMacUpdatedAt",updated_at AS "updatedAt"`,[p.data.name,p.data.licensePlate||'',p.data.btMac||null,req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Fahrzeug nicht gefunden'});res.json(r.rows[0]);});
app.put('/api/vehicles/:id/bluetooth', requireAuth, async(req,res)=>{const p=vehicleBluetoothSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Bluetooth-MAC muss dem Format AA:BB:CC:DD:EE:FF entsprechen oder null sein'});try{const r=await pool.query(`UPDATE vehicles SET bt_mac=$1,bt_mac_updated_at=CASE WHEN bt_mac IS DISTINCT FROM $1 THEN NOW() ELSE bt_mac_updated_at END,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING id,name,license_plate AS "licensePlate",bt_mac AS "btMac",bt_mac_updated_at AS "btMacUpdatedAt",updated_at AS "updatedAt"`,[p.data.btMac,req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Fahrzeug nicht gefunden'});res.json(r.rows[0]);}catch(e){if(e.code==='23505')return res.status(409).json({error:'Diese Bluetooth-MAC ist bereits einem anderen Fahrzeug zugeordnet'});throw e;}});

async function readTrip(userId,tripId){
  const r=await pool.query(`SELECT t.id,t.vehicle_id AS "vehicleId",v.name AS "vehicleName",v.license_plate AS "licensePlate",t.trip_type AS "tripType",t.tracking_status AS "trackingStatus",t.started_at AS "startedAt",t.ended_at AS "endedAt",t.start_location AS "startLocation",t.destination_location AS "destinationLocation",t.start_latitude AS "startLatitude",t.start_longitude AS "startLongitude",t.destination_latitude AS "destinationLatitude",t.destination_longitude AS "destinationLongitude",t.start_odometer_km::float AS "startOdometerKm",t.end_odometer_km::float AS "endOdometerKm",t.distance_km::float AS "distanceKm",t.purpose,t.notes,COALESCE(array_agg(tag.name ORDER BY tag.name) FILTER(WHERE tag.id IS NOT NULL),'{}') AS tags FROM trips t JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN trip_tags tt ON tt.trip_id=t.id LEFT JOIN tags tag ON tag.id=tt.tag_id WHERE t.id=$1 AND t.user_id=$2 GROUP BY t.id,v.id`,[tripId,userId]);
  return r.rows[0];
}
app.get('/api/trips/:id', requireAuth, async(req,res)=>{const trip=await readTrip(req.user.id,req.params.id);if(!trip)return res.status(404).json({error:'Fahrt nicht gefunden'});res.json(trip);});
app.put('/api/trips/:id', requireAuth, async(req,res)=>{const p=tripSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige Fahrtdaten',details:p.error.flatten()});const result=await withTransaction(async c=>{const d=p.data;if(!(await c.query('SELECT id FROM vehicles WHERE id=$1 AND user_id=$2',[d.vehicleId,req.user.id])).rowCount)throw Object.assign(new Error('Fahrzeug nicht gefunden'),{status:404});const r=await c.query(`UPDATE trips SET vehicle_id=$1,trip_type=$2,started_at=$3,ended_at=$4,start_location=$5,destination_location=$6,start_latitude=$7,start_longitude=$8,destination_latitude=$9,destination_longitude=$10,start_odometer_km=$11,end_odometer_km=$12,distance_km=$13,purpose=$14,notes=$15,updated_at=NOW() WHERE id=$16 AND user_id=$17 RETURNING id`,[d.vehicleId,d.tripType,d.startedAt,d.endedAt,d.startLocation,d.destinationLocation,d.startLatitude,d.startLongitude,d.destinationLatitude,d.destinationLongitude,d.startOdometerKm,d.endOdometerKm,d.distanceKm,d.purpose,d.notes,req.params.id,req.user.id]);if(!r.rowCount)throw Object.assign(new Error('Fahrt nicht gefunden'),{status:404});await c.query('DELETE FROM trip_tags WHERE trip_id=$1',[req.params.id]);for(const name of [...new Set(d.tags.map(x=>x.toLowerCase()))]){const tag=await c.query(`INSERT INTO tags(user_id,name) VALUES($1,$2) ON CONFLICT(user_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[req.user.id,name]);await c.query('INSERT INTO trip_tags(trip_id,tag_id) VALUES($1,$2)',[req.params.id,tag.rows[0].id]);}return r.rows[0];});res.json(await readTrip(req.user.id,result.id));});

app.post('/api/tracking/start', requireAuth, async(req,res)=>{const p=z.object({vehicleId:z.string().uuid(),tripType:z.enum(['commute','private','business']).default('private'),startedAt:z.string().datetime().optional(),startLocation:z.string().trim().max(255).optional(),startLatitude:z.number().min(-90).max(90).optional(),startLongitude:z.number().min(-180).max(180).optional(),startOdometerKm:z.number().nonnegative().optional(),purpose:z.string().trim().max(255).optional(),tags:z.array(z.string().trim().min(1).max(50)).max(20).default([])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige Trackingdaten'});const d=p.data;const trip=await withTransaction(async c=>{if(!(await c.query('SELECT id FROM vehicles WHERE id=$1 AND user_id=$2',[d.vehicleId,req.user.id])).rowCount)throw Object.assign(new Error('Fahrzeug nicht gefunden'),{status:404});const r=await c.query(`INSERT INTO trips(user_id,vehicle_id,trip_type,tracking_status,started_at,start_location,destination_location,start_latitude,start_longitude,start_odometer_km,purpose) VALUES($1,$2,$3,'recording',$4,$5,'Wird bei Fahrtende ermittelt',$6,$7,$8,$9) RETURNING id`,[req.user.id,d.vehicleId,d.tripType,d.startedAt||new Date().toISOString(),d.startLocation||'GPS-Aufzeichnung',d.startLatitude??null,d.startLongitude??null,d.startOdometerKm??null,d.purpose??null]);for(const name of [...new Set(d.tags.map(x=>x.toLowerCase()))]){const tag=await c.query(`INSERT INTO tags(user_id,name) VALUES($1,$2) ON CONFLICT(user_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[req.user.id,name]);await c.query('INSERT INTO trip_tags(trip_id,tag_id) VALUES($1,$2)',[r.rows[0].id,tag.rows[0].id]);}return r.rows[0];});res.status(201).json(await readTrip(req.user.id,trip.id));});
app.post('/api/tracking/:tripId/points', requireAuth, async(req,res)=>{req.params.id=req.params.tripId;const p=z.object({points:z.array(tripPointSchema).min(1).max(5000)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültige GPS-Punkte'});const count=await withTransaction(async c=>{if(!(await c.query(`SELECT id FROM trips WHERE id=$1 AND user_id=$2 AND tracking_status='recording' FOR UPDATE`,[req.params.tripId,req.user.id])).rowCount)throw Object.assign(new Error('Aktive Fahrt nicht gefunden'),{status:404});for(const x of p.data.points)await c.query(`INSERT INTO trip_points(trip_id,recorded_at,latitude,longitude,altitude_m,speed_kmh,accuracy_m,sequence_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(trip_id,sequence_number) DO UPDATE SET recorded_at=EXCLUDED.recorded_at,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,altitude_m=EXCLUDED.altitude_m,speed_kmh=EXCLUDED.speed_kmh,accuracy_m=EXCLUDED.accuracy_m`,[req.params.tripId,x.recordedAt,x.latitude,x.longitude,x.altitudeM,x.speedKmh,x.accuracyM,x.sequenceNumber]);return Number((await c.query('SELECT COUNT(*) FROM trip_points WHERE trip_id=$1',[req.params.tripId])).rows[0].count);});res.status(201).json({stored:p.data.points.length,total:count});});
app.post('/api/tracking/:tripId/stop', requireAuth, async(req,res)=>{const p=z.object({endedAt:z.string().datetime().optional(),destinationLocation:z.string().trim().max(255).optional(),destinationLatitude:z.number().min(-90).max(90).optional(),destinationLongitude:z.number().min(-180).max(180).optional(),endOdometerKm:z.number().nonnegative().optional(),distanceKm:z.number().nonnegative().optional(),notes:z.string().trim().max(2000).optional()}).safeParse(req.body||{});if(!p.success)return res.status(400).json({error:'Ungültige Abschlussdaten'});const d=p.data;const r=await pool.query(`UPDATE trips SET tracking_status='completed',ended_at=$1,destination_location=COALESCE($2,destination_location),destination_latitude=COALESCE($3,destination_latitude),destination_longitude=COALESCE($4,destination_longitude),end_odometer_km=COALESCE($5,end_odometer_km),distance_km=COALESCE($6,distance_km),notes=COALESCE($7,notes),updated_at=NOW() WHERE id=$8 AND user_id=$9 AND tracking_status='recording' RETURNING id`,[d.endedAt||new Date().toISOString(),d.destinationLocation||null,d.destinationLatitude??null,d.destinationLongitude??null,d.endOdometerKm??null,d.distanceKm??null,d.notes||null,req.params.tripId,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Aktive Fahrt nicht gefunden'});res.json(await readTrip(req.user.id,req.params.tripId));});
app.get('/api/tracking/:tripId', requireAuth, async(req,res)=>{const trip=await readTrip(req.user.id,req.params.tripId);if(!trip)return res.status(404).json({error:'Fahrt nicht gefunden'});const points=(await pool.query(`SELECT recorded_at AS "recordedAt",latitude,longitude,altitude_m AS "altitudeM",speed_kmh AS "speedKmh",accuracy_m AS "accuracyM",sequence_number AS "sequenceNumber" FROM trip_points WHERE trip_id=$1 ORDER BY sequence_number`,[req.params.tripId])).rows;res.json({trip,points});});

app.post('/api/tags', requireAuth, async(req,res)=>{const p=z.object({name:z.string().trim().min(1).max(50)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültiger Tag'});try{const r=await pool.query(`INSERT INTO tags(user_id,name) VALUES($1,$2) RETURNING id,name`,[req.user.id,p.data.name.toLowerCase()]);res.status(201).json(r.rows[0]);}catch(e){if(e.code==='23505')return res.status(409).json({error:'Tag existiert bereits'});throw e;}});
app.put('/api/tags/:id', requireAuth, async(req,res)=>{const p=z.object({name:z.string().trim().min(1).max(50)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Ungültiger Tag'});try{const r=await pool.query(`UPDATE tags SET name=$1 WHERE id=$2 AND user_id=$3 RETURNING id,name`,[p.data.name.toLowerCase(),req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Tag nicht gefunden'});res.json(r.rows[0]);}catch(e){if(e.code==='23505')return res.status(409).json({error:'Tag existiert bereits'});throw e;}});
app.delete('/api/tags/:id', requireAuth, async(req,res)=>{const r=await pool.query('DELETE FROM tags WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Tag nicht gefunden'});res.status(204).end();});

app.get('/api/map/trips', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT t.id,t.trip_type AS "tripType",t.started_at AS "startedAt",t.start_location AS "startLocation",t.destination_location AS "destinationLocation",t.start_latitude AS "startLatitude",t.start_longitude AS "startLongitude",t.destination_latitude AS "destinationLatitude",t.destination_longitude AS "destinationLongitude",t.distance_km::float AS "distanceKm",v.name AS "vehicleName",(SELECT COUNT(*)::int FROM trip_points p WHERE p.trip_id=t.id) AS "pointCount" FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.user_id=$1 ORDER BY t.started_at DESC`,[req.user.id]);res.json(r.rows);});
app.get('/api/map/trips/:tripId', requireAuth, async(req,res)=>{const trip=await readTrip(req.user.id,req.params.tripId);if(!trip)return res.status(404).json({error:'Fahrt nicht gefunden'});const coordinates=(await pool.query('SELECT longitude,latitude FROM trip_points WHERE trip_id=$1 ORDER BY sequence_number',[req.params.tripId])).rows.map(x=>[x.longitude,x.latitude]);res.json({type:'Feature',geometry:{type:'LineString',coordinates},properties:trip});});

app.get('/api/settings', requireAuth, async(req,res)=>{const r=await pool.query('SELECT settings FROM user_settings WHERE user_id=$1',[req.user.id]);res.json(r.rows[0]?.settings||{});});
app.put('/api/settings', requireAuth, async(req,res)=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'Einstellungen müssen ein JSON-Objekt sein'});const r=await pool.query(`INSERT INTO user_settings(user_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW() RETURNING settings`,[req.user.id,JSON.stringify(req.body)]);res.json(r.rows[0].settings);});

app.get('/api/statistics', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT COUNT(*)::int AS "tripCount",COALESCE(SUM(distance_km),0)::float AS "distanceKm",COUNT(*) FILTER(WHERE trip_type='commute')::int AS commute,COUNT(*) FILTER(WHERE trip_type='private')::int AS private,COUNT(*) FILTER(WHERE trip_type='business')::int AS business FROM trips WHERE user_id=$1`,[req.user.id]);res.json(r.rows[0]);});
app.get('/api/statistics/vehicles', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT v.id,v.name,COUNT(t.id)::int AS "tripCount",COALESCE(SUM(t.distance_km),0)::float AS "distanceKm" FROM vehicles v LEFT JOIN trips t ON t.vehicle_id=v.id WHERE v.user_id=$1 GROUP BY v.id ORDER BY v.name`,[req.user.id]);res.json(r.rows);});
app.get('/api/statistics/trips', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT trip_type AS "tripType",COUNT(*)::int AS "tripCount",COALESCE(SUM(distance_km),0)::float AS "distanceKm" FROM trips WHERE user_id=$1 GROUP BY trip_type ORDER BY trip_type`,[req.user.id]);res.json(r.rows);});
app.get('/api/statistics/tags', requireAuth, async(req,res)=>{const r=await pool.query(`SELECT tag.id,tag.name,COUNT(tt.trip_id)::int AS "tripCount" FROM tags tag LEFT JOIN trip_tags tt ON tt.tag_id=tag.id WHERE tag.user_id=$1 GROUP BY tag.id ORDER BY "tripCount" DESC,tag.name`,[req.user.id]);res.json(r.rows);});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async(req,res)=>{const p=z.object({password:z.string().min(10).max(200)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Passwort muss mindestens 10 Zeichen haben'});const r=await pool.query('UPDATE users SET password_hash=$1,must_change_password=FALSE,updated_at=NOW() WHERE id=$2 RETURNING id',[await bcrypt.hash(p.data.password,12),req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Benutzer nicht gefunden'});await pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[req.params.id]);res.json({updated:true});});
app.post('/api/admin/users/:id/activate', requireAuth, requireAdmin, async(req,res)=>{const r=await pool.query('UPDATE users SET is_active=TRUE,updated_at=NOW() WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Benutzer nicht gefunden'});res.json({active:true});});
app.post('/api/admin/users/:id/deactivate', requireAuth, requireAdmin, async(req,res)=>{if(req.params.id===req.user.id)return res.status(409).json({error:'Das eigene Konto kann nicht deaktiviert werden'});const target=(await pool.query('SELECT role,is_active FROM users WHERE id=$1',[req.params.id])).rows[0];if(!target)return res.status(404).json({error:'Benutzer nicht gefunden'});if(target.role==='admin'&&target.is_active){const count=Number((await pool.query(`SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=TRUE`)).rows[0].count);if(count<=1)return res.status(409).json({error:'Der letzte aktive Administrator kann nicht deaktiviert werden'});}await pool.query('UPDATE users SET is_active=FALSE,updated_at=NOW() WHERE id=$1',[req.params.id]);await pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[req.params.id]);res.json({active:false});});

app.get('/api/geocoding/reverse', requireAuth, async(req,res)=>{const lat=Number(req.query.lat),lon=Number(req.query.lon);if(!Number.isFinite(lat)||lat < -90||lat>90||!Number.isFinite(lon)||lon < -180||lon>180)return res.status(400).json({error:'Ungültige Koordinaten'});if(!process.env.PHOTON_URL)return res.status(503).json({error:'Keine Photon-Instanz konfiguriert'});const r=await fetch(`${process.env.PHOTON_URL.replace(/\/$/,'')}/reverse?lat=${lat}&lon=${lon}&lang=de`);if(!r.ok)return res.status(502).json({error:'Photon-Anfrage fehlgeschlagen'});res.json(await r.json());});

app.get('/api/geocoding/search', requireAuth, async(req,res)=>{const q=String(req.query.q||'').trim();if(q.length<2)return res.status(400).json({error:'Suchbegriff ist zu kurz'});if(!process.env.PHOTON_URL)return res.status(503).json({error:'Keine Photon-Instanz konfiguriert'});const r=await fetch(`${process.env.PHOTON_URL.replace(/\/$/,'')}/api/?q=${encodeURIComponent(q)}&limit=8&lang=de`);if(!r.ok)return res.status(502).json({error:'Photon-Anfrage fehlgeschlagen'});res.json(await r.json());});
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}

app.use((error,_req,res,_next)=>{console.error(error);res.status(error.status||500).json({error:error.message||'Interner Serverfehler'});});
await runMigrations();await ensureDefaultAdmin();app.listen(port,'0.0.0.0',()=>console.log(`Fahrtenbuch API läuft auf Port ${port}`));
