import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { requireAuth, requireRole } from '../auth.js';
import { uploadRateLimit } from '../rateLimit.js';

/**
 * Upload de capas. Persiste em UPLOAD_DIR (volume montado no compose),
 * retorna URL pública relativa (/uploads/yyyy/mm/<hash>.<ext>).
 * Caddy serve esse prefixo diretamente via reverse_proxy pro container.
 */

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/uploads';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const parsedMaxBytes = Number(process.env.UPLOAD_MAX_BYTES || DEFAULT_MAX_BYTES);
const MAX_BYTES = Number.isFinite(parsedMaxBytes) && parsedMaxBytes > 0 ? parsedMaxBytes : DEFAULT_MAX_BYTES;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
]);

// Garante que o dir base existe (docker volume → sempre existe, mas
// defense-in-depth em dev local também).
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const subdir = path.join(UPLOAD_DIR, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(subdir, { recursive: true });
    cb(null, subdir);
  },
  filename: (_req, file, cb) => {
    const safeExt = MIME_EXTENSIONS.get(file.mimetype) || '.bin';
    const rand = crypto.randomBytes(12).toString('hex');
    cb(null, `${rand}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('invalid_mime'));
    }
    cb(null, true);
  },
});

const router = Router();
const requireEditor = [requireAuth, requireRole('admin', 'editor')];

function hasAllowedImageSignature(filePath, mime) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(32);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    const head = header.subarray(0, bytesRead);

    if (mime === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    if (mime === 'image/gif') return head.subarray(0, 6).toString('ascii') === 'GIF87a' || head.subarray(0, 6).toString('ascii') === 'GIF89a';
    if (mime === 'image/webp') return head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
    if (mime === 'image/avif') {
      const brands = head.subarray(8).toString('ascii');
      return head.subarray(4, 8).toString('ascii') === 'ftyp' && (brands.includes('avif') || brands.includes('avis'));
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

function removeUploadedFile(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

router.post('/', requireEditor, uploadRateLimit, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large', max: MAX_BYTES });
      if (err.code?.startsWith('LIMIT_')) return res.status(400).json({ error: 'invalid_upload' });
      if (err.message === 'invalid_mime') return res.status(400).json({ error: 'invalid_mime_type' });
      // eslint-disable-next-line no-console
      console.error('[upload error]', err.message);
      return res.status(500).json({ error: 'upload_failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'no_file' });

    let isValidImage = false;
    try {
      isValidImage = hasAllowedImageSignature(req.file.path, req.file.mimetype);
    } catch (signatureErr) {
      removeUploadedFile(req.file);
      // eslint-disable-next-line no-console
      console.error('[upload signature error]', signatureErr.message);
      return res.status(500).json({ error: 'upload_failed' });
    }

    if (!isValidImage) {
      removeUploadedFile(req.file);
      return res.status(400).json({ error: 'invalid_image_file' });
    }
    // Constrói URL pública relativa (Caddy monta o host na frente)
    const rel = path.relative(UPLOAD_DIR, req.file.path).replaceAll(path.sep, '/');
    const url = `/uploads/${rel}`;
    res.status(201).json({
      url,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  });
});

export default router;
