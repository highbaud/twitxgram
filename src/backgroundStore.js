'use strict';

/*
 * Custom background store — lets a user upload their own background image, saves
 * it for reuse, and lists/removes saved ones. Uploads are decoded, downscaled,
 * and re-encoded to WebP via sharp (which also strips EXIF/GPS metadata), so the
 * stored files stay small and clean. Metadata lives in data/backgrounds.json;
 * the image files live in backgrounds/ (served statically for thumbnails, read
 * directly as a data: URI at render time — no network, no SSRF surface).
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'backgrounds.json');
const BG_DIR = path.join(__dirname, '..', 'backgrounds');
const MAX_COUNT = Number(process.env.MAX_CUSTOM_BACKGROUNDS || 60);
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // pre-resize decoded cap
const MAX_WIDTH = 1600;

const dataUriCache = new Map(); // id → data: URI (files are write-once)

function load() {
  try { const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); return Array.isArray(s) ? s : []; }
  catch { return []; }
}
function save(list) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(list, null, 2)); }

/** Validate + decode an `data:image/...;base64,...` string. Throws on anything else. */
function parseImageDataUri(dataUri) {
  const m = /^data:image\/(png|jpe?g|webp|gif|avif);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUri || '').trim());
  if (!m) throw new Error('Not a valid base64 image data URI');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0) throw new Error('Empty image');
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error('Image too large (max 12 MB)');
  return { mime: `image/${m[1]}`, buffer: buf };
}

function list() {
  return load().map(e => ({ id: e.id, name: e.name, url: `/backgrounds/${e.filename}`, addedAt: e.addedAt }));
}

async function add({ name, dataUri }) {
  const items = load();
  if (items.length >= MAX_COUNT) throw new Error(`Background limit reached (${MAX_COUNT}) — remove some first`);
  const { buffer } = parseImageDataUri(dataUri);

  // Downscale + re-encode (strips metadata, bounds file size). limitInputPixels
  // guards against decompression bombs (tiny file → huge canvas → OOM).
  const out = await sharp(buffer, { limitInputPixels: 50_000_000 })
    .rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();

  const id = crypto.randomBytes(6).toString('hex');
  const filename = `bg-${id}.webp`;
  fs.mkdirSync(BG_DIR, { recursive: true });
  fs.writeFileSync(path.join(BG_DIR, filename), out);

  const entry = {
    id, filename,
    name: String(name || 'Background').trim().slice(0, 60) || 'Background',
    addedAt: new Date().toISOString(),
  };
  items.unshift(entry);
  save(items);
  return { id: entry.id, name: entry.name, url: `/backgrounds/${filename}`, addedAt: entry.addedAt };
}

function remove(id) {
  const items = load();
  const entry = items.find(e => e.id === id);
  if (!entry) return false;
  try { fs.unlinkSync(path.join(BG_DIR, entry.filename)); } catch {}
  save(items.filter(e => e.id !== id));
  dataUriCache.delete(id);
  return true;
}

/** Read a saved background as a data: URI (cached). Returns null if unknown. */
function getDataUri(id) {
  if (dataUriCache.has(id)) return dataUriCache.get(id);
  const entry = load().find(e => e.id === id);
  if (!entry) return null;
  try {
    const buf = fs.readFileSync(path.join(BG_DIR, entry.filename));
    const uri = `data:image/webp;base64,${buf.toString('base64')}`;
    dataUriCache.set(id, uri);
    return uri;
  } catch { return null; }
}

module.exports = { list, add, remove, getDataUri, parseImageDataUri, BG_DIR, MAX_COUNT };
