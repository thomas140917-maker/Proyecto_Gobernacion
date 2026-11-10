import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COLORES_CABELLO, COLORES_OJOS, DIALECTOS, GENEROS, PROVINCIAS, TONOS_PIEL,
} from '../common/catalogos';
import { fechaLimiteMayoriaEdad } from '../common/fechas';
import { analizarEnlaceVideo } from '../multimedia/enlaces-video';
import { PrismaService } from '../prisma/prisma.service';
import { MiniaturasService } from '../storage/miniaturas.service';
import { StorageService } from '../storage/storage.service';
import { VitrinaQueryDto } from './dto/vitrina.dto';

/**
 * Qué se publica: SOLO perfiles APROBADOS, de mayores de edad, que autorizaron expresamente
 * la vitrina. Nunca se devuelven correo, teléfono, documento, fecha de nacimiento ni apellidos
 * (si no hay nombre artístico, solo el primer nombre). Los DOCUMENTO jamás son públicos.
 */
const SELECT = {
  actor_id: true,
  nombre_artistico: true,
  genero: true,
  edad_aparente_min: true,
  edad_aparente_max: true,
  estatura_cm: true,
  tono_piel: true,
  color_ojos: true,
  color_cabello: true,
  dialecto: true,
  provincia: true,
  actor: {
    select: {
      nombre_completo: true,
      municipio: true,
      habilidades: { select: { habilidad: { select: { habilidad_id: true, nombre: true } } } },
    },
  },
} satisfies Prisma.perfiles_actoresSelect;

type FilaVitrina = Prisma.perfiles_actoresGetPayload<{ select: typeof SELECT }>;

const primerNombre = (completo: string) => completo.trim().split(/\s+/)[0];

@Injectable()
export class VitrinaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly miniaturas: MiniaturasService,
    private readonly storage: StorageService,
  ) {}

  private baseWhere(): Prisma.perfiles_actoresWhereInput {
    return {
      estado: 'APROBADO',
      autoriza_vitrina_publica: true,
      actor: { esta_activo: true, fecha_nacimiento: { lte: fechaLimiteMayoriaEdad() } },
    };
  }

  // ------------------------------------------------------------ búsqueda
  async buscar(q: VitrinaQueryDto) {
    const { page = 1, limit = 20 } = q;
    if (q.estatura_min !== undefined && q.estatura_max !== undefined && q.estatura_min > q.estatura_max) {
      throw new BadRequestException('estatura_min no puede ser mayor que estatura_max');
    }

    const filtros: Prisma.perfiles_actoresWhereInput[] = [];
    if (q.estatura_min !== undefined) filtros.push({ estatura_cm: { gte: q.estatura_min } });
    if (q.estatura_max !== undefined) filtros.push({ estatura_cm: { lte: q.estatura_max } });
    if (q.tono_piel) filtros.push({ tono_piel: q.tono_piel });
    if (q.dialecto) filtros.push({ dialecto: q.dialecto });
    if (q.provincia) filtros.push({ provincia: q.provincia });
    if (q.genero) filtros.push({ genero: q.genero });
    if (q.municipio) filtros.push({ actor: { municipio: { equals: q.municipio, mode: 'insensitive' } } });
    if (q.edad !== undefined) {
      filtros.push({ edad_aparente_min: { lte: q.edad } }, { edad_aparente_max: { gte: q.edad } });
    }
    if (q.habilidades?.length) {
      if (q.habilidades_modo === 'alguna') {
        filtros.push({ actor: { habilidades: { some: { habilidad_id: { in: q.habilidades } } } } });
      } else {
        for (const id of new Set(q.habilidades)) {
          filtros.push({ actor: { habilidades: { some: { habilidad_id: id } } } });
        }
      }
    }

    const where: Prisma.perfiles_actoresWhereInput = { ...this.baseWhere(), AND: filtros };
    const [total, filas] = await this.prisma.$transaction([
      this.prisma.perfiles_actores.count({ where }),
      this.prisma.perfiles_actores.findMany({
        where,
        select: SELECT,
        orderBy: [{ actualizado_en: 'desc' }, { actor_id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const fotos = await this.miniaturas.deActores(filas.map((f) => f.actor_id));
    return {
      data: filas.map((f) => this.presentar(f, fotos.get(f.actor_id) ?? null)),
      total,
      page,
      limit,
      total_paginas: Math.ceil(total / limit),
    };
  }

  // ------------------------------------------------------------ detalle
  async obtener(actorId: string) {
    const fila = await this.prisma.perfiles_actores.findFirst({
      where: { ...this.baseWhere(), actor_id: actorId },
      select: { ...SELECT, biografia: true },
    });
    // Si no cumple las condiciones de publicación, "no existe" (no se revela nada).
    if (!fila) throw new NotFoundException('Perfil no encontrado');

    const multimedia = await this.prisma.archivos_multimedia.findMany({
      where: {
        actor_id: actorId,
        tipo_archivo: { in: ['FOTO_PERFIL', 'FOTO_BOOK', 'REEL_PRESENTACION', 'ENLACE_PORTAFOLIO'] },
      },
      orderBy: [{ tipo_archivo: 'asc' }, { subido_en: 'desc' }],
    });

    const galeria = await Promise.all(
      multimedia.map(async (m) => {
        if (m.almacenamiento === 'EXTERNO') {
          return {
            tipo: m.tipo_archivo, titulo: m.titulo, proveedor: m.proveedor_video,
            url_embed: analizarEnlaceVideo(m.url_archivo)?.url_embed ?? null,
          };
        }
        const [url, url_miniatura] = await Promise.all([
          this.storage.urlFirmada(m.url_archivo),
          m.url_miniatura ? this.storage.urlFirmada(m.url_miniatura) : Promise.resolve(null),
        ]);
        return { tipo: m.tipo_archivo, titulo: m.titulo, url, url_miniatura, ancho: m.ancho, alto: m.alto };
      }),
    );

    return { ...this.presentar(fila, null), biografia: fila.biografia, multimedia: galeria };
  }

  // ------------------------------------------------------------ filtros disponibles
  async filtros() {
    const habilidades = await this.prisma.habilidades.findMany({
      select: { habilidad_id: true, nombre: true, tipo: true },
      orderBy: { nombre: 'asc' },
    });
    return {
      generos: GENEROS, tonos_piel: TONOS_PIEL, colores_ojos: COLORES_OJOS, colores_cabello: COLORES_CABELLO,
      dialectos: DIALECTOS, provincias: PROVINCIAS, habilidades,
    };
  }

  private presentar(f: FilaVitrina, foto: string | null) {
    return {
      id: f.actor_id,
      nombre: f.nombre_artistico ?? primerNombre(f.actor.nombre_completo),
      genero: f.genero,
      edad_aparente: f.edad_aparente_min !== null ? { min: f.edad_aparente_min, max: f.edad_aparente_max } : null,
      estatura_cm: f.estatura_cm,
      tono_piel: f.tono_piel,
      color_ojos: f.color_ojos,
      color_cabello: f.color_cabello,
      dialecto: f.dialecto,
      provincia: f.provincia,
      municipio: f.actor.municipio,
      habilidades: f.actor.habilidades.map((h) => ({ id: h.habilidad.habilidad_id, nombre: h.habilidad.nombre })),
      foto_miniatura_url: foto,
    };
  }
}
