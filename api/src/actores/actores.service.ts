import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { aColumnasPerfil, snapshotPerfil } from '../common/campos-perfil';
import { calcularEdad, parseFechaISO } from '../common/fechas';
import { hashPassword } from '../common/password.util';
import { validarEdadAparente } from '../common/validaciones';
import { ImagenService } from '../multimedia/imagen.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RegistroPublicoDto } from './dto/registro-publico.dto';
import { firmaValidaBuffer } from './file-signature';
import { EXTENSION_POR_MIME } from './upload.config';

export type ArchivosRegistro = {
  foto_perfil?: Express.Multer.File[];
  documento_autorizacion?: Express.Multer.File[];
};

@Injectable()
export class ActoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imagenes: ImagenService,
  ) {}

  async registroPublico(dto: RegistroPublicoDto, files: ArchivosRegistro) {
    const foto = files.foto_perfil?.[0];
    const autorizacion = files.documento_autorizacion?.[0];

    for (const f of [foto, autorizacion]) {
      if (f && !firmaValidaBuffer(f.mimetype, f.buffer)) {
        throw new BadRequestException(`El archivo "${f.fieldname}" no corresponde al tipo declarado`);
      }
    }

    const nacimiento = parseFechaISO(dto.fecha_nacimiento);
    if (!nacimiento) throw new BadRequestException('fecha_nacimiento no es una fecha válida');
    const edad = calcularEdad(nacimiento);
    if (edad < 0 || edad > 110) throw new BadRequestException('fecha_nacimiento fuera de rango');
    const esMenor = edad < 18;
    validarEdadAparente(dto.edad_aparente_min, dto.edad_aparente_max);

    // RF-19: menor de edad => acudiente completo + autorización firmada
    if (esMenor) {
      const faltantes = [
        'nombre_acudiente', 'documento_acudiente', 'telefono_acudiente', 'correo_acudiente',
      ].filter((c) => !dto[c]);
      if (!autorizacion) faltantes.push('documento_autorizacion');
      if (faltantes.length) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: 'El actor es menor de 18 años: se requieren los datos del acudiente y su autorización',
          campos_faltantes: faltantes,
        });
      }
      if (dto.documento_acudiente === dto.numero_documento) {
        throw new BadRequestException('El documento del acudiente no puede ser el del menor');
      }
    }

    // Duplicados ANTES de subir nada a S3 (evita trabajo y objetos huérfanos en el caso más común).
    // Se informa qué dato está duplicado a cambio de una mejor experiencia; el endpoint tiene rate-limit.
    const existente = await this.prisma.actores.findFirst({
      where: { OR: [{ correo: dto.correo }, { numero_documento: dto.numero_documento }] },
      select: { correo: true },
    });
    if (existente) throw this.duplicado(existente.correo === dto.correo ? 'correo' : 'numero_documento');

    const contrasena_hash = await hashPassword(dto.contrasena);
    const actorId = randomUUID(); // se conoce antes de insertar: las claves de S3 llevan el actor_id
    const subidos: string[] = [];

    try {
      // ---- archivos -> S3 (si algo falla después, se borran en el catch) ----
      let fotoS3: { principal: string; miniatura: string; ancho: number; alto: number; tamano: number } | null = null;
      if (foto) {
        const img = await this.imagenes.procesar(foto.buffer); // valida, quita EXIF y optimiza (WebP)
        const base = `actores/${actorId}/foto_perfil/${randomUUID()}`;
        fotoS3 = { principal: `${base}.webp`, miniatura: `${base}_thumb.webp`, ancho: img.ancho, alto: img.alto, tamano: img.tamano };
        subidos.push(fotoS3.principal, fotoS3.miniatura);
        await Promise.all([
          this.storage.subir(fotoS3.principal, img.principal, 'image/webp'),
          this.storage.subir(fotoS3.miniatura, img.miniatura, 'image/webp'),
        ]);
      }
      let claveAutorizacion: string | null = null;
      if (autorizacion) {
        claveAutorizacion = `autorizaciones/${actorId}/${randomUUID()}${EXTENSION_POR_MIME[autorizacion.mimetype]}`;
        subidos.push(claveAutorizacion);
        await this.storage.subir(claveAutorizacion, autorizacion.buffer, autorizacion.mimetype);
      }

      const actor = await this.prisma.$transaction(async (tx) => {
        const creado = await tx.actores.create({
          data: {
            actor_id: actorId,
            correo: dto.correo,
            contrasena_hash,
            nombre_completo: dto.nombre_completo,
            tipo_documento: dto.tipo_documento,
            numero_documento: dto.numero_documento,
            fecha_nacimiento: nacimiento,
            municipio: dto.municipio,
            ciudad: dto.ciudad,
            telefono: dto.telefono,
            acepta_terminos: dto.acepta_terminos,
          },
        });

        const datosPerfil = snapshotPerfil({
          nombre_artistico: dto.nombre_artistico,
          tiene_experiencia: dto.tiene_experiencia,
          biografia: dto.biografia,
          foto_perfil_url: fotoS3?.principal ?? null,
          estatura_cm: dto.estatura_cm,
          color_ojos: dto.color_ojos,
          color_cabello: dto.color_cabello,
          tono_piel: dto.tono_piel,
          contextura: dto.contextura,
          genero: dto.genero,
          edad_aparente_min: dto.edad_aparente_min,
          edad_aparente_max: dto.edad_aparente_max,
          dialecto: dto.dialecto,
          provincia: dto.provincia,
        });

        await tx.perfiles_actores.create({
          data: {
            actor_id: creado.actor_id,
            ...aColumnasPerfil(datosPerfil),
            estado: 'PENDIENTE',
            autoriza_vitrina_publica: dto.autoriza_vitrina_publica ?? false,
          },
        });
        // Doble estado: la versión 1 queda PENDIENTE hasta que un admin la apruebe o rechace.
        await tx.perfiles_versiones.create({
          data: { actor_id: creado.actor_id, numero_version: 1, datos: datosPerfil, estado: 'PENDIENTE' },
        });

        // La foto del registro es también la FOTO_PERFIL de la multimedia (la usa la vitrina).
        if (fotoS3) {
          await tx.archivos_multimedia.create({
            data: {
              actor_id: creado.actor_id,
              tipo_archivo: 'FOTO_PERFIL',
              almacenamiento: 'S3',
              url_archivo: fotoS3.principal,
              url_miniatura: fotoS3.miniatura,
              mime_type: 'image/webp',
              tamano_bytes: fotoS3.tamano,
              ancho: fotoS3.ancho,
              alto: fotoS3.alto,
            },
          });
        }

        if (esMenor) {
          await tx.acudientes_legales.create({
            data: {
              actor_id: creado.actor_id,
              nombre_acudiente: dto.nombre_acudiente,
              documento_acudiente: dto.documento_acudiente,
              telefono_acudiente: dto.telefono_acudiente,
              correo_acudiente: dto.correo_acudiente,
              url_documento_autorizacion: claveAutorizacion as string,
            },
          });
        }

        await tx.historial_auditoria.create({
          data: {
            tipo_accion: 'CREAR',
            entidad_afectada: 'actores',
            entidad_id: creado.actor_id,
            realizado_por_actor_id: creado.actor_id,
            observacion_accion: esMenor
              ? 'Registro público de actor menor de edad'
              : 'Registro público de actor',
          },
        });
        return creado;
      });

      return {
        actor_id: actor.actor_id,
        estado_perfil: 'PENDIENTE',
        es_menor_de_edad: esMenor,
        message: 'Inscripción recibida. Tu perfil quedó pendiente de revisión.',
      };
    } catch (e) {
      await this.storage.eliminar(subidos); // sin objetos huérfanos en S3
      // Carrera entre dos registros simultáneos con el mismo dato
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw this.duplicado(String(e.meta?.target ?? '').includes('numero_documento') ? 'numero_documento' : 'correo');
      }
      throw e;
    }
  }

  private duplicado(campo: 'correo' | 'numero_documento') {
    return new ConflictException(
      campo === 'numero_documento'
        ? 'Ya existe una inscripción con ese número de documento'
        : 'Ya existe una inscripción con ese correo',
    );
  }
}
