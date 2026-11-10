import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, convocatorias, convocatorias_habilidades, estado_convocatoria_enum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CambiarEstadoConvocatoriaDto, ConvocatoriaDto, ListarConvocatoriasDto } from './dto/convocatoria.dto';
import { puedeCambiarConvocatoria } from './transiciones';

type ConHabilidades = convocatorias & {
  habilidades: (convocatorias_habilidades & { habilidad: { nombre: string } })[];
};
const INCLUDE = { habilidades: { include: { habilidad: { select: { nombre: true } } } } } as const;
const VISIBLES_AL_PUBLICO: estado_convocatoria_enum[] = ['ACTIVA', 'PROXIMA'];

@Injectable()
export class ConvocatoriasService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ crear / actualizar
  async crear(dto: ConvocatoriaDto, adminId: string) {
    const datos = await this.validar(dto);
    const ahora = new Date();
    // Con apertura futura queda PROXIMA (el programador la activa); sin fecha o ya vencida, ACTIVA.
    const estado: estado_convocatoria_enum = datos.fecha_apertura && datos.fecha_apertura > ahora ? 'PROXIMA' : 'ACTIVA';

    const creada = await this.prisma.$transaction(async (tx) => {
      const c = await tx.convocatorias.create({
        data: {
          ...datos.columnas,
          creado_por_admin_id: adminId,
          estado,
          habilidades: { create: datos.habilidades },
        },
        include: INCLUDE,
      });
      await this.auditar(tx, adminId, c.convocatoria_id, 'CREAR_CONVOCATORIA', { accion: 'CREAR', estado });
      return c;
    });
    return this.presentar(creada, true);
  }

  async actualizar(id: string, dto: ConvocatoriaDto, adminId: string) {
    const actual = await this.prisma.convocatorias.findUnique({ where: { convocatoria_id: id } });
    if (!actual) throw new NotFoundException('Convocatoria no encontrada');
    if (actual.estado === 'CERRADA') throw new ConflictException('Una convocatoria cerrada no se puede editar');

    const datos = await this.validar(dto);
    const seleccionados = await this.prisma.postulaciones_castings.count({
      where: { convocatoria_id: id, estado: 'SELECCIONADO' },
    });
    if (datos.columnas.cupo_maximo < seleccionados) {
      throw new ConflictException(`Ya hay ${seleccionados} seleccionados: el cupo no puede ser menor`);
    }

    const actualizada = await this.prisma.$transaction(async (tx) => {
      await tx.convocatorias_habilidades.deleteMany({ where: { convocatoria_id: id } });
      const c = await tx.convocatorias.update({
        where: { convocatoria_id: id },
        data: { ...datos.columnas, actualizado_en: new Date(), habilidades: { create: datos.habilidades } },
        include: INCLUDE,
      });
      await this.auditar(tx, adminId, id, 'ACTUALIZAR_CONVOCATORIA', { accion: 'ACTUALIZAR' });
      return c;
    });
    return this.presentar(actualizada, true);
  }

  // ------------------------------------------------------------ estados
  async cambiarEstado(id: string, dto: CambiarEstadoConvocatoriaDto, adminId: string) {
    const actual = await this.prisma.convocatorias.findUnique({ where: { convocatoria_id: id } });
    if (!actual) throw new NotFoundException('Convocatoria no encontrada');
    if (!puedeCambiarConvocatoria(actual.estado, dto.estado)) {
      throw new ConflictException(`No se puede pasar de ${actual.estado} a ${dto.estado}`);
    }
    if (dto.estado === 'ACTIVA' && actual.fecha_cierre <= new Date()) {
      throw new ConflictException('La fecha de cierre ya pasó: edita la convocatoria con una fecha futura antes de activarla');
    }

    await this.prisma.$transaction(async (tx) => {
      // Guardia atómica: si otro admin (o el programador) cambió el estado, count = 0.
      const r = await tx.convocatorias.updateMany({
        where: { convocatoria_id: id, estado: actual.estado },
        data: { estado: dto.estado, actualizado_en: new Date() },
      });
      if (r.count !== 1) throw new ConflictException('El estado cambió mientras lo editabas; recarga la convocatoria');
      await this.auditar(tx, adminId, id, 'CAMBIAR_ESTADO_CONVOCATORIA', {
        accion: 'CAMBIAR_ESTADO', de: actual.estado, a: dto.estado, motivo: dto.motivo ?? null,
      });
    });
    return { convocatoria_id: id, estado_anterior: actual.estado, estado: dto.estado };
  }

  // ------------------------------------------------------------ consulta
  async listar(q: ListarConvocatoriasDto, esAdmin: boolean) {
    const { page = 1, limit = 20 } = q;
    const where: Prisma.convocatoriasWhereInput = esAdmin
      ? q.estado ? { estado: q.estado } : {}
      : { estado: { in: VISIBLES_AL_PUBLICO } };

    const [total, filas] = await this.prisma.$transaction([
      this.prisma.convocatorias.count({ where }),
      this.prisma.convocatorias.findMany({
        where, include: INCLUDE,
        orderBy: [{ fecha_cierre: 'asc' }, { convocatoria_id: 'asc' }],
        skip: (page - 1) * limit, take: limit,
      }),
    ]);
    return { data: filas.map((c) => this.presentar(c, esAdmin)), total, page, limit };
  }

  async obtener(id: string, esAdmin: boolean) {
    const c = await this.prisma.convocatorias.findUnique({ where: { convocatoria_id: id }, include: INCLUDE });
    // Para el público, una convocatoria no visible "no existe" (no se filtra información).
    if (!c || (!esAdmin && !VISIBLES_AL_PUBLICO.includes(c.estado))) {
      throw new NotFoundException('Convocatoria no encontrada');
    }
    return this.presentar(c, esAdmin);
  }

  // ------------------------------------------------------------ utilidades
  /** Valida reglas cruzadas y devuelve las columnas listas para guardar. */
  private async validar(dto: ConvocatoriaDto) {
    const cierre = new Date(dto.fecha_cierre);
    const apertura = dto.fecha_apertura ? new Date(dto.fecha_apertura) : null;
    if (cierre <= new Date()) throw new BadRequestException('fecha_cierre debe ser una fecha futura');
    if (apertura && apertura >= cierre) throw new BadRequestException('fecha_apertura debe ser anterior a fecha_cierre');
    if (dto.edad_aparente_min != null && dto.edad_aparente_max != null && dto.edad_aparente_min > dto.edad_aparente_max) {
      throw new BadRequestException('edad_aparente_min no puede ser mayor que edad_aparente_max');
    }
    if (dto.estatura_min_cm != null && dto.estatura_max_cm != null && dto.estatura_min_cm > dto.estatura_max_cm) {
      throw new BadRequestException('estatura_min_cm no puede ser mayor que estatura_max_cm');
    }

    const habilidades = (dto.habilidades ?? []).map((h) => ({
      habilidad_id: h.habilidad_id, obligatoria: h.obligatoria ?? true,
    }));
    const ids = habilidades.map((h) => h.habilidad_id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay destrezas repetidas');
    if (ids.length) {
      const existentes = await this.prisma.habilidades.count({ where: { habilidad_id: { in: ids } } });
      if (existentes !== ids.length) throw new BadRequestException('Alguna destreza indicada no existe');
    }

    return {
      fecha_apertura: apertura,
      habilidades,
      columnas: {
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        requisitos: dto.requisitos ?? null,
        ubicacion: dto.ubicacion ?? null,
        modalidad: dto.modalidad,
        cupo_maximo: dto.cupo_maximo,
        fecha_apertura: apertura,
        fecha_cierre: cierre,
        edad_aparente_min: dto.edad_aparente_min ?? null,
        edad_aparente_max: dto.edad_aparente_max ?? null,
        estatura_min_cm: dto.estatura_min_cm ?? null,
        estatura_max_cm: dto.estatura_max_cm ?? null,
        generos: dto.generos ?? [],
        tonos_piel: dto.tonos_piel ?? [],
        colores_ojos: dto.colores_ojos ?? [],
        colores_cabello: dto.colores_cabello ?? [],
        dialectos: dto.dialectos ?? [],
        provincias: dto.provincias ?? [],
        municipios: dto.municipios ?? [],
        solo_mayores_de_edad: dto.solo_mayores_de_edad ?? false,
      },
    };
  }

  /** El público no ve datos internos (quién la creó); el admin sí. */
  private presentar(c: ConHabilidades, esAdmin: boolean) {
    const { creado_por_admin_id, habilidades, ...resto } = c;
    return {
      ...resto,
      ...(esAdmin ? { creado_por_admin_id } : {}),
      habilidades: habilidades.map((h) => ({
        habilidad_id: h.habilidad_id, nombre: h.habilidad.nombre, obligatoria: h.obligatoria,
      })),
    };
  }

  private auditar(
    tx: Prisma.TransactionClient, adminId: string, convocatoriaId: string, observacion: string,
    detalle: Prisma.InputJsonObject,
  ) {
    return tx.historial_auditoria.create({
      data: {
        tipo_accion: 'ACCION_ADMINISTRADOR',
        entidad_afectada: 'convocatorias',
        entidad_id: convocatoriaId,
        realizado_por_admin_id: adminId,
        observacion_accion: observacion,
        detalle,
      },
    });
  }
}
