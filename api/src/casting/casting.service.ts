import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, estado_postulacion_enum } from '@prisma/client';
import { calcularEdad, fechaLimiteMayoriaEdad } from '../common/fechas';
import { PrismaService } from '../prisma/prisma.service';
import { MiniaturasService } from '../storage/miniaturas.service';
import { CandidatosQueryDto } from './casting.dto';
import { evaluarCompatibilidad } from './compatibilidad';
import { perfilCastingDesdeActor, requisitosDesdeConvocatoria } from './mapeadores';

const MAX_TARJETAS = 500;
const MAX_CANDIDATOS = 500;

@Injectable()
export class CastingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly miniaturas: MiniaturasService,
  ) {}

  // ------------------------------------------------------------ Kanban
  async kanban(convocatoriaId: string) {
    const conv = await this.prisma.convocatorias.findUnique({
      where: { convocatoria_id: convocatoriaId },
      select: { convocatoria_id: true, titulo: true, estado: true, cupo_maximo: true },
    });
    if (!conv) throw new NotFoundException('Convocatoria no encontrada');

    const filas = await this.prisma.postulaciones_castings.findMany({
      where: { convocatoria_id: convocatoriaId },
      orderBy: [{ compatibilidad: 'desc' }, { postulado_en: 'asc' }],
      take: MAX_TARJETAS + 1,
      include: {
        actor: {
          select: {
            actor_id: true, nombre_completo: true, municipio: true, fecha_nacimiento: true,
            perfil: { select: { nombre_artistico: true, edad_aparente_min: true, edad_aparente_max: true } },
          },
        },
      },
    });
    const truncado = filas.length > MAX_TARJETAS;
    const visibles = filas.slice(0, MAX_TARJETAS);
    const fotos = await this.miniaturas.deActores([...new Set(visibles.map((f) => f.actor_id))]);

    // Una columna por estado, aunque esté vacía (el tablero siempre las muestra todas)
    const columnas = Object.fromEntries(
      Object.values(estado_postulacion_enum).map((e) => [e, [] as unknown[]]),
    ) as Record<estado_postulacion_enum, unknown[]>;

    for (const f of visibles) {
      const perfil = f.actor.perfil;
      columnas[f.estado].push({
        postulacion_id: f.postulacion_id,
        actor_id: f.actor_id,
        nombre_completo: f.actor.nombre_completo,
        nombre_artistico: perfil?.nombre_artistico ?? null,
        municipio: f.actor.municipio,
        es_menor_de_edad: calcularEdad(f.actor.fecha_nacimiento) < 18,
        edad_aparente: perfil?.edad_aparente_min != null ? { min: perfil.edad_aparente_min, max: perfil.edad_aparente_max } : null,
        compatibilidad: f.compatibilidad,
        notas_admin: f.notas_admin,
        postulado_en: f.postulado_en,
        foto_miniatura_url: fotos.get(f.actor_id) ?? null,
      });
    }

    return {
      convocatoria: { ...conv, seleccionados: columnas.SELECCIONADO.length, vacantes_libres: Math.max(0, conv.cupo_maximo - columnas.SELECCIONADO.length) },
      totales: Object.fromEntries(Object.entries(columnas).map(([k, v]) => [k, v.length])),
      truncado,
      columnas,
    };
  }

  // ------------------------------------------------------------ Casting inteligente
  /**
   * Rankea actores APROBADOS que cumplen los requisitos duros de la convocatoria, por compatibilidad.
   * Los requisitos duros "baratos" (género, estatura, edad aparente) se filtran en la BD;
   * destrezas y puntaje se calculan en memoria sobre un máximo de 500 candidatos.
   * Es una herramienta interna del admin: no exige la autorización de vitrina pública.
   */
  async candidatos(convocatoriaId: string, q: CandidatosQueryDto) {
    const { page = 1, limit = 20, min_compatibilidad = 0 } = q;
    const conv = await this.prisma.convocatorias.findUnique({
      where: { convocatoria_id: convocatoriaId },
      include: { habilidades: { include: { habilidad: { select: { nombre: true } } } } },
    });
    if (!conv) throw new NotFoundException('Convocatoria no encontrada');
    const req = requisitosDesdeConvocatoria(conv);

    const filtrosPerfil: Prisma.perfiles_actoresWhereInput[] = [];
    if (req.generos.length) filtrosPerfil.push({ genero: { in: req.generos } });
    if (req.estatura_min_cm !== null) filtrosPerfil.push({ estatura_cm: { gte: req.estatura_min_cm } });
    if (req.estatura_max_cm !== null) filtrosPerfil.push({ estatura_cm: { lte: req.estatura_max_cm } });
    if (req.edad_aparente_max !== null) filtrosPerfil.push({ edad_aparente_min: { lte: req.edad_aparente_max } });
    if (req.edad_aparente_min !== null) filtrosPerfil.push({ edad_aparente_max: { gte: req.edad_aparente_min } });

    const limiteAdulto = fechaLimiteMayoriaEdad();
    const where: Prisma.actoresWhereInput = {
      esta_activo: true,
      perfil: { is: { estado: 'APROBADO', AND: filtrosPerfil } },
      // Menores: solo si la convocatoria los admite y su acudiente está verificado
      ...(req.solo_mayores_de_edad
        ? { fecha_nacimiento: { lte: limiteAdulto } }
        : { OR: [{ fecha_nacimiento: { lte: limiteAdulto } }, { acudientes: { some: { esta_verificado: true } } }] }),
    };

    const actores = await this.prisma.actores.findMany({
      where,
      orderBy: { creado_en: 'desc' },
      take: MAX_CANDIDATOS + 1,
      include: {
        perfil: true,
        habilidades: { select: { habilidad_id: true } },
        postulaciones: { where: { convocatoria_id: convocatoriaId }, select: { estado: true } },
      },
    });
    const truncado = actores.length > MAX_CANDIDATOS;

    const ranking = actores
      .slice(0, MAX_CANDIDATOS)
      .map((a) => ({ a, r: evaluarCompatibilidad(perfilCastingDesdeActor(a), req) }))
      .filter(({ r }) => r.cumple && r.compatibilidad >= min_compatibilidad)
      .sort((x, y) => y.r.compatibilidad - x.r.compatibilidad || x.a.nombre_completo.localeCompare(y.a.nombre_completo));

    const pagina = ranking.slice((page - 1) * limit, page * limit);
    const fotos = await this.miniaturas.deActores(pagina.map(({ a }) => a.actor_id));

    return {
      data: pagina.map(({ a, r }) => ({
        actor_id: a.actor_id,
        nombre_completo: a.nombre_completo,
        nombre_artistico: a.perfil?.nombre_artistico ?? null,
        municipio: a.municipio,
        provincia: a.perfil?.provincia ?? null,
        es_menor_de_edad: calcularEdad(a.fecha_nacimiento) < 18,
        compatibilidad: r.compatibilidad,
        opcionales_no_cumplidos: r.opcionales_no_cumplidos,
        ya_postulado: a.postulaciones.length > 0,
        estado_postulacion: a.postulaciones[0]?.estado ?? null,
        foto_miniatura_url: fotos.get(a.actor_id) ?? null,
      })),
      total: ranking.length,
      page,
      limit,
      truncado, // true = había más de 500 candidatos; afina los requisitos de la convocatoria
    };
  }
}
