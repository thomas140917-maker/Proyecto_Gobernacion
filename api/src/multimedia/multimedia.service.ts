import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma, archivos_multimedia, tipo_multimedia_enum } from '@prisma/client';
import { randomUUID } from 'crypto';
import { firmaValidaBuffer } from '../actores/file-signature';
import { UsuarioSesion } from '../auth/bearer';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CrearMultimediaDto } from './dto/crear-multimedia.dto';
import { analizarEnlaceVideo, exigirEnlaceVideo } from './enlaces-video';
import { ImagenService } from './imagen.service';

/** Cupos por actor. FOTO_PERFIL es una sola: la nueva reemplaza a la anterior. */
const CUPOS: Record<tipo_multimedia_enum, number> = {
  FOTO_PERFIL: 1,
  FOTO_BOOK: 10,
  REEL_PRESENTACION: 3,
  ENLACE_PORTAFOLIO: 5,
  DOCUMENTO: 5,
};
const TIPOS_IMAGEN: tipo_multimedia_enum[] = ['FOTO_PERFIL', 'FOTO_BOOK'];
const TIPOS_ENLACE: tipo_multimedia_enum[] = ['REEL_PRESENTACION', 'ENLACE_PORTAFOLIO'];
const MIMES_IMAGEN = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PDF_BYTES = 5 * 1024 * 1024;

type DatosFila = Omit<Prisma.archivos_multimediaUncheckedCreateInput, 'actor_id' | 'tipo_archivo'>;

@Injectable()
export class MultimediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imagenes: ImagenService,
  ) {}

  // ---------------------------------------------------------------- crear
  async crear(actorId: string, usuario: UsuarioSesion, dto: CrearMultimediaDto, archivo?: Express.Multer.File) {
    this.autorizar(usuario, actorId);
    await this.exigirActor(actorId);

    const fila = TIPOS_ENLACE.includes(dto.tipo)
      ? await this.crearEnlace(actorId, usuario, dto, archivo)
      : await this.crearArchivo(actorId, usuario, dto, archivo);
    return this.presentar(fila);
  }

  private async crearEnlace(
    actorId: string, usuario: UsuarioSesion, dto: CrearMultimediaDto, archivo?: Express.Multer.File,
  ) {
    if (archivo) throw new BadRequestException('Este tipo solo admite "url", no un archivo');
    if (!dto.url) throw new BadRequestException('"url" es obligatoria para este tipo');
    const enlace = exigirEnlaceVideo(dto.url);
    await this.verificarCupo(actorId, dto.tipo);
    try {
      return await this.guardar(actorId, usuario, dto.tipo, {
        url_archivo: enlace.url_canonica,
        almacenamiento: 'EXTERNO',
        proveedor_video: enlace.proveedor,
        id_video: enlace.id_video,
        titulo: dto.titulo ?? null,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ese enlace ya está registrado en el perfil');
      }
      throw e;
    }
  }

  private async crearArchivo(
    actorId: string, usuario: UsuarioSesion, dto: CrearMultimediaDto, archivo?: Express.Multer.File,
  ) {
    if (dto.url) throw new BadRequestException('Este tipo solo admite un archivo, no "url"');
    if (!archivo) throw new BadRequestException('"archivo" es obligatorio para este tipo');

    const esImagen = TIPOS_IMAGEN.includes(dto.tipo);
    const mimeOk = esImagen ? MIMES_IMAGEN.has(archivo.mimetype) : archivo.mimetype === 'application/pdf';
    if (!mimeOk) {
      throw new UnsupportedMediaTypeException(
        esImagen ? 'Solo se admiten imágenes JPEG, PNG o WebP' : 'Solo se admiten documentos PDF',
      );
    }
    // El MIME lo declara el cliente: se contrasta con el contenido real del archivo.
    if (!firmaValidaBuffer(archivo.mimetype, archivo.buffer)) {
      throw new BadRequestException('El contenido del archivo no corresponde a su tipo declarado');
    }
    if (!esImagen && archivo.size > MAX_PDF_BYTES) {
      throw new PayloadTooLargeException('Los documentos PDF no pueden superar 5 MB');
    }
    await this.verificarCupo(actorId, dto.tipo);

    const claves: string[] = [];
    let fila: archivos_multimedia;
    try {
      const base = `actores/${actorId}/${dto.tipo.toLowerCase()}/${randomUUID()}`;
      let datos: DatosFila;
      if (esImagen) {
        const img = await this.imagenes.procesar(archivo.buffer);
        claves.push(`${base}.webp`, `${base}_thumb.webp`);
        await Promise.all([
          this.storage.subir(claves[0], img.principal, 'image/webp'),
          this.storage.subir(claves[1], img.miniatura, 'image/webp'),
        ]);
        datos = {
          url_archivo: claves[0], url_miniatura: claves[1], mime_type: 'image/webp',
          tamano_bytes: img.tamano, ancho: img.ancho, alto: img.alto,
        };
      } else {
        claves.push(`${base}.pdf`);
        await this.storage.subir(claves[0], archivo.buffer, 'application/pdf');
        datos = { url_archivo: claves[0], mime_type: 'application/pdf', tamano_bytes: archivo.size };
      }
      fila = await this.guardar(actorId, usuario, dto.tipo, {
        ...datos, almacenamiento: 'S3', titulo: dto.titulo ?? null,
      });
    } catch (e) {
      await this.storage.eliminar(claves); // sin objetos huérfanos si algo falla
      throw e;
    }
    return fila;
  }

  /** Inserta con cupo garantizado (lock por actor) y auditoría, todo en una transacción. */
  private async guardar(actorId: string, usuario: UsuarioSesion, tipo: tipo_multimedia_enum, datos: DatosFila) {
    const { fila, reemplazadas } = await this.prisma.$transaction(async (tx) => {
      // Serializa altas concurrentes del mismo actor: el cupo no se puede saltar con peticiones en paralelo.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId}))`;

      let reemplazadas: string[] = [];
      if (tipo === 'FOTO_PERFIL') {
        const previas = await tx.archivos_multimedia.findMany({ where: { actor_id: actorId, tipo_archivo: tipo } });
        if (previas.length) {
          await tx.archivos_multimedia.deleteMany({
            where: { multimedia_id: { in: previas.map((p) => p.multimedia_id) } },
          });
          reemplazadas = previas.flatMap(clavesAlmacenadas);
        }
      } else {
        const n = await tx.archivos_multimedia.count({ where: { actor_id: actorId, tipo_archivo: tipo } });
        if (n >= CUPOS[tipo]) throw new ConflictException(mensajeCupo(tipo));
      }

      const fila = await tx.archivos_multimedia.create({
        data: { ...datos, actor_id: actorId, tipo_archivo: tipo },
      });
      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'CREAR',
          entidad_afectada: 'archivos_multimedia',
          entidad_id: fila.multimedia_id,
          ...autor(usuario),
          observacion_accion: `Alta de multimedia ${tipo}`,
          detalle: { tipo, actor_id: actorId, reemplazo: reemplazadas.length > 0 },
        },
      });
      return { fila, reemplazadas };
    });

    if (reemplazadas.length) await this.storage.eliminar(reemplazadas);
    return fila;
  }

  // ---------------------------------------------------------------- listar / eliminar
  async listar(actorId: string, usuario: UsuarioSesion, tipo?: tipo_multimedia_enum) {
    this.autorizar(usuario, actorId);
    await this.exigirActor(actorId);
    const filas = await this.prisma.archivos_multimedia.findMany({
      where: { actor_id: actorId, ...(tipo ? { tipo_archivo: tipo } : {}) },
      orderBy: [{ tipo_archivo: 'asc' }, { subido_en: 'desc' }],
    });
    return Promise.all(filas.map((f) => this.presentar(f)));
  }

  async eliminar(actorId: string, usuario: UsuarioSesion, multimediaId: string) {
    this.autorizar(usuario, actorId);
    const fila = await this.prisma.archivos_multimedia.findFirst({
      where: { multimedia_id: multimediaId, actor_id: actorId },
    });
    if (!fila) throw new NotFoundException('Archivo no encontrado');

    await this.prisma.$transaction(async (tx) => {
      await tx.archivos_multimedia.delete({ where: { multimedia_id: multimediaId } });
      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ELIMINAR',
          entidad_afectada: 'archivos_multimedia',
          entidad_id: multimediaId,
          ...autor(usuario),
          observacion_accion: `Baja de multimedia ${fila.tipo_archivo}`,
          detalle: { tipo: fila.tipo_archivo, actor_id: actorId },
        },
      });
    });
    await this.storage.eliminar(clavesAlmacenadas(fila));
    return { message: 'Archivo eliminado' };
  }

  // ---------------------------------------------------------------- utilidades
  private autorizar(usuario: UsuarioSesion, actorId: string) {
    if (usuario.tipo === 'ACTOR' && usuario.id !== actorId) {
      throw new ForbiddenException('Solo puedes gestionar tu propio perfil');
    }
  }

  private async exigirActor(actorId: string) {
    const actor = await this.prisma.actores.findUnique({ where: { actor_id: actorId }, select: { actor_id: true } });
    if (!actor) throw new NotFoundException('Actor no encontrado');
  }

  /** Verificación rápida antes de procesar; la definitiva se hace dentro de la transacción. */
  private async verificarCupo(actorId: string, tipo: tipo_multimedia_enum) {
    if (tipo === 'FOTO_PERFIL') return;
    const n = await this.prisma.archivos_multimedia.count({ where: { actor_id: actorId, tipo_archivo: tipo } });
    if (n >= CUPOS[tipo]) throw new ConflictException(mensajeCupo(tipo));
  }

  private async presentar(m: archivos_multimedia) {
    const base = {
      multimedia_id: m.multimedia_id,
      tipo: m.tipo_archivo,
      titulo: m.titulo,
      almacenamiento: m.almacenamiento,
      mime_type: m.mime_type,
      tamano_bytes: m.tamano_bytes,
      ancho: m.ancho,
      alto: m.alto,
      subido_en: m.subido_en,
    };
    if (m.almacenamiento === 'EXTERNO') {
      return {
        ...base,
        proveedor_video: m.proveedor_video,
        id_video: m.id_video,
        url: m.url_archivo,
        url_embed: analizarEnlaceVideo(m.url_archivo)?.url_embed ?? null,
        url_miniatura: null,
      };
    }
    const [url, url_miniatura] = await Promise.all([
      this.storage.urlFirmada(m.url_archivo, m.tipo_archivo === 'DOCUMENTO'),
      m.url_miniatura ? this.storage.urlFirmada(m.url_miniatura) : Promise.resolve(null),
    ]);
    return { ...base, url, url_miniatura, url_expira_en_segundos: this.storage.ttl };
  }
}

function clavesAlmacenadas(m: archivos_multimedia): string[] {
  return m.almacenamiento === 'S3' ? [m.url_archivo, m.url_miniatura].filter((c): c is string => !!c) : [];
}

function autor(u: UsuarioSesion) {
  return {
    realizado_por_admin_id: u.tipo === 'ADMIN' ? u.id : null,
    realizado_por_actor_id: u.tipo === 'ACTOR' ? u.id : null,
  };
}

function mensajeCupo(tipo: tipo_multimedia_enum) {
  return `Alcanzaste el máximo de ${CUPOS[tipo]} elemento(s) de tipo ${tipo}. Elimina uno para agregar otro`;
}
