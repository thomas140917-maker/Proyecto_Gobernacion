// Almacenamiento de archivos del módulo web.
//  - STORAGE=s3 (por defecto si hay S3_BUCKET): mismo bucket, mismas claves y URLs firmadas que el backend.
//  - STORAGE=local: carpeta ./uploads (útil sin Docker/MinIO).
// Las imágenes se procesan igual que ImagenService: WebP, máx. 2048 px, miniatura 400 px, sin EXIF.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const cfg = require('./config');
const { fail } = require('./util');

const LADO_MAXIMO = 2048;
const LADO_MINIATURA = 400;
const MAX_PIXELES = 40_000_000;
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));

// ---------------------------------------------------------------- firmas (igual que file-signature.ts)
const FIRMAS = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('ascii') === '%PDF-',
};
const firmaValida = (mime, b) => !!FIRMAS[mime] && b.length >= 12 && FIRMAS[mime](b);
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

// ---------------------------------------------------------------- S3 (carga perezosa)
let _s3;
function s3() {
  if (_s3) return _s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  const e = cfg.env;
  const base = {
    region: e.S3_REGION || 'us-east-1',
    ...(e.S3_ACCESS_KEY && e.S3_SECRET_KEY ? { credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY } } : {}),
    forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
    maxAttempts: 4,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
  const endpoint = e.S3_ENDPOINT || undefined;
  _s3 = {
    cliente: new S3Client({ ...base, endpoint }),
    firmador: new S3Client({ ...base, endpoint: e.S3_PUBLIC_ENDPOINT || endpoint }),
  };
  return _s3;
}

async function subir(clave, buffer, contentType) {
  if (cfg.S3_ACTIVO) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3().cliente.send(new PutObjectCommand({ Bucket: cfg.env.S3_BUCKET, Key: clave, Body: buffer, ContentType: contentType }));
    return;
  }
  const destino = path.join(UPLOADS_DIR, clave);
  await fs.promises.mkdir(path.dirname(destino), { recursive: true });
  await fs.promises.writeFile(destino, buffer);
}

/** Borrado de mejor esfuerzo (un fallo no tumba la petición). */
async function eliminar(claves) {
  claves = (claves || []).filter(Boolean);
  if (!claves.length) return;
  try {
    if (cfg.S3_ACTIVO) {
      const { DeleteObjectsCommand } = require('@aws-sdk/client-s3');
      await s3().cliente.send(new DeleteObjectsCommand({
        Bucket: cfg.env.S3_BUCKET, Delete: { Objects: claves.map((Key) => ({ Key })), Quiet: true } }));
    } else {
      await Promise.all(claves.map((c) => fs.promises.rm(path.join(UPLOADS_DIR, c), { force: true })));
    }
  } catch (e) { console.error('[web] no se pudieron borrar archivos:', e.message); }
}

/** Lee un archivo completo (para servir documentos privados a través de la API). null si no existe. */
async function leer(clave) {
  try {
    if (cfg.S3_ACTIVO) {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const r = await s3().cliente.send(new GetObjectCommand({ Bucket: cfg.env.S3_BUCKET, Key: clave }));
      return Buffer.from(await r.Body.transformToByteArray());
    }
    const destino = path.resolve(UPLOADS_DIR, clave.replace(/^\/uploads\//, ''));
    if (!destino.startsWith(UPLOADS_DIR + path.sep)) return null;
    return await fs.promises.readFile(destino);
  } catch { return null; }
}

/** Una clave guardada en BD -> URL que el navegador puede abrir. Las URL absolutas o /uploads/ (datos antiguos) pasan tal cual. */
async function urlDe(clave, descarga = false) {
  if (!clave) return null;
  if (/^https?:\/\//i.test(clave) || clave.startsWith('/uploads/')) return clave;
  if (cfg.S3_ACTIVO) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    return getSignedUrl(s3().firmador, new GetObjectCommand({
      Bucket: cfg.env.S3_BUCKET, Key: clave,
      ResponseContentDisposition: descarga ? 'attachment; filename="documento.pdf"' : undefined }), { expiresIn: cfg.SIGNED_URL_TTL });
  }
  return '/uploads/' + clave.split('/').map(encodeURIComponent).join('/');
}

/** Clave de la miniatura asociada a una imagen principal (convención del backend: .webp -> _thumb.webp). */
const claveMiniatura = (clave) => (clave && clave.endsWith('.webp') ? clave.replace(/\.webp$/, '_thumb.webp') : null);

// ---------------------------------------------------------------- procesamiento de imágenes
let _sharp;
function sharp() {
  if (_sharp === undefined) {
    try { _sharp = require('sharp'); _sharp.concurrency(2); _sharp.cache({ memory: 64, files: 0, items: 50 }); } catch { _sharp = null; }
  }
  return _sharp;
}

// Máx. 3 imágenes procesándose a la vez (como Limitador(3, 20) del backend)
let activos = 0; const cola = [];
async function conCupo(fn) {
  if (activos >= 3) {
    if (cola.length >= 20) throw fail(503, 'El servidor está procesando muchas imágenes. Intenta de nuevo en unos segundos.');
    await new Promise((r) => cola.push(r));
  }
  activos++;
  try { return await fn(); } finally { activos--; const n = cola.shift(); if (n) n(); }
}

/** Valida y optimiza una imagen. Devuelve { principal, miniatura, ancho, alto, tamano }. */
function procesarImagen(buffer) {
  return conCupo(async () => {
    const sh = sharp();
    if (!sh) throw fail(500, 'El servidor no tiene el procesador de imágenes (sharp) instalado.');
    const op = { limitInputPixels: MAX_PIXELES, failOn: 'error' };
    try {
      const meta = await sh(buffer, op).metadata();
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw fail(400, 'Formato de imagen no permitido (solo JPEG, PNG o WebP)');
      if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELES) throw fail(400, 'La imagen supera la resolución máxima permitida (40 megapíxeles)');
      const base = () => sh(buffer, op).rotate();
      const [principal, miniatura] = await Promise.all([
        base().resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true }),
        base().resize({ width: LADO_MINIATURA, height: LADO_MINIATURA, fit: 'cover', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
      ]);
      return { principal: principal.data, miniatura, ancho: principal.info.width, alto: principal.info.height, tamano: principal.info.size };
    } catch (e) {
      if (e && e.status) throw e;
      throw fail(422, 'La imagen está dañada o no se pudo procesar');
    }
  });
}

/**
 * Valida (tipo, firma) y guarda una imagen con las claves del backend:
 * actores/<id>/<tipo>/<uuid>.webp y ..._thumb.webp. Devuelve los datos de fila y las claves (para limpiar si algo falla).
 */
async function guardarImagen(actorId, tipoCarpeta, archivo) {
  if (!MIMES_IMAGEN.includes(archivo.mimetype)) throw fail(415, 'Solo se admiten imágenes JPEG, PNG o WebP');
  if (!firmaValida(archivo.mimetype, archivo.buffer)) throw fail(400, 'El contenido del archivo no corresponde a su tipo declarado');
  const img = await procesarImagen(archivo.buffer);
  const b = `actores/${actorId}/${tipoCarpeta}/${randomUUID()}`;
  const claves = [`${b}.webp`, `${b}_thumb.webp`];
  try {
    await Promise.all([subir(claves[0], img.principal, 'image/webp'), subir(claves[1], img.miniatura, 'image/webp')]);
  } catch (e) { await eliminar(claves); throw e; }
  return {
    claves,
    fila: { url_archivo: claves[0], url_miniatura: claves[1], mime_type: 'image/webp', tamano_bytes: img.tamano, ancho: img.ancho, alto: img.alto },
  };
}

/** Documento (PDF o imagen) como la autorización del acudiente. */
async function guardarDocumento(carpeta, id, archivo, permitidos = ['application/pdf', 'image/jpeg', 'image/png']) {
  if (!permitidos.includes(archivo.mimetype)) throw fail(400, `Archivo no permitido (${archivo.mimetype})`);
  if (!firmaValida(archivo.mimetype, archivo.buffer)) throw fail(400, 'El contenido del archivo no corresponde a su tipo declarado');
  const clave = `${carpeta}/${id}/${randomUUID()}${EXT[archivo.mimetype]}`;
  await subir(clave, archivo.buffer, archivo.mimetype);
  return clave;
}

/** Imagen de portada de cursos/convocatorias/noticias (la sube el administrador). Se guarda como clave y se firma al leer. */
async function guardarPortada(carpeta, archivo) {
  if (!MIMES_IMAGEN.includes(archivo.mimetype)) throw fail(415, 'Solo se admiten imágenes JPEG, PNG o WebP');
  if (!firmaValida(archivo.mimetype, archivo.buffer)) throw fail(400, 'El contenido del archivo no corresponde a su tipo declarado');
  const img = await procesarImagen(archivo.buffer);
  const clave = `${carpeta}/${randomUUID()}.webp`;
  await subir(clave, img.principal, 'image/webp');
  return clave;
}

module.exports = { leer, UPLOADS_DIR, firmaValida, MIMES_IMAGEN, subir, eliminar, urlDe, claveMiniatura, guardarImagen, guardarDocumento, guardarPortada };
