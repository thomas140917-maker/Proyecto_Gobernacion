import { BadRequestException, HttpException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';
import { Limitador } from '../common/limitador';

const MAX_PIXELES = 40_000_000; // ~40 MP: protege contra "bombas de descompresión"
const LADO_MAXIMO = 2048;
const LADO_MINIATURA = 400;

export interface ImagenProcesada {
  principal: Buffer;
  miniatura: Buffer;
  ancho: number;
  alto: number;
  tamano: number;
}

@Injectable()
export class ImagenService {
  // Máx. 3 imágenes procesándose a la vez; hasta 20 en espera, el resto recibe 503.
  private readonly limitador = new Limitador(3, 20);

  constructor() {
    sharp.concurrency(2);
    sharp.cache({ memory: 64, files: 0, items: 50 });
  }

  procesar(buffer: Buffer): Promise<ImagenProcesada> {
    return this.limitador.ejecutar(() => this.procesarInterno(buffer));
  }

  private async procesarInterno(buffer: Buffer): Promise<ImagenProcesada> {
    const opciones = { limitInputPixels: MAX_PIXELES, failOn: 'error' as const };
    try {
      const meta = await sharp(buffer, opciones).metadata();
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) {
        throw new BadRequestException('Formato de imagen no permitido (solo JPEG, PNG o WebP)');
      }
      if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELES) {
        throw new BadRequestException('La imagen supera la resolución máxima permitida (40 megapíxeles)');
      }

      // rotate(): aplica la orientación EXIF. Sharp NO copia metadatos al resultado (se elimina EXIF/GPS).
      const base = () => sharp(buffer, opciones).rotate();
      const [principal, miniatura] = await Promise.all([
        base()
          .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true }),
        base()
          .resize({ width: LADO_MINIATURA, height: LADO_MINIATURA, fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer(),
      ]);

      return {
        principal: principal.data,
        miniatura,
        ancho: principal.info.width,
        alto: principal.info.height,
        tamano: principal.info.size,
      };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new UnprocessableEntityException('La imagen está dañada o no se pudo procesar');
    }
  }
}
