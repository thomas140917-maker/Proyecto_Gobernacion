import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

/** Tipos permitidos por campo (el contenido real se contrasta después con los magic bytes). */
const PERMITIDOS: Record<string, string[]> = {
  foto_perfil: ['image/jpeg', 'image/png', 'image/webp'],
  documento_autorizacion: ['application/pdf', 'image/jpeg', 'image/png'],
};

export const EXTENSION_POR_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * En memoria (no en disco): los contenedores de ECS/Render tienen disco efímero y los archivos
 * se suben a S3. Límites estrictos de tamaño y cantidad de campos.
 */
export const registroMulterOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 40, fieldSize: 64 * 1024, parts: 50 },
  fileFilter: (_req, file, cb) => {
    if (PERMITIDOS[file.fieldname]?.includes(file.mimetype)) return cb(null, true);
    cb(new BadRequestException(`Archivo no permitido en "${file.fieldname}" (${file.mimetype})`), false);
  },
};
