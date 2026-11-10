import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PROVINCIAS } from '../common/catalogos';
import { parseFechaISO } from '../common/fechas';
import { PrismaService } from '../prisma/prisma.service';
import { aCsv } from './csv';
import { generarPdfReporte } from './pdf-reporte';

const RANGOS_ETARIOS = ['0-17', '18-25', '26-35', '36-45', '46-60', '61+'];
const ETIQUETA_PROVINCIA = new Map<string, string>([...PROVINCIAS.map((p) => [p.codigo, p.etiqueta] as [string, string]), ['SIN_DATO', 'Sin dato']]);
const CACHE_MS = 60_000;

const pct = (n: number, total: number) => (total > 0 ? Math.round((n * 1000) / total) / 10 : 0);

export interface Estadisticas {
  generado_en: string;
  rango: { desde: string | null; hasta: string | null };
  resumen: {
    total_actores: number; total_perfiles: number; perfiles_aprobados: number;
    porcentaje_perfiles_aprobados: number; postulaciones_activas: number;
  };
  actores_por_provincia: { provincia: string; etiqueta: string; total: number; porcentaje: number }[];
  rangos_etarios: { rango: string; total: number; porcentaje: number }[];
  perfiles_por_estado: { estado: string; total: number; porcentaje: number }[];
  postulaciones_activas: { total: number; por_estado: { estado: string; total: number }[] };
  registros_por_mes: { mes: string; total: number }[];
  convocatorias_por_estado: { estado: string; total: number }[];
}

@Injectable()
export class ReportesService {
  private readonly cache = new Map<string, { hasta: number; datos: Estadisticas }>();
  private readonly institucion: string;
  private readonly color: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.institucion = config.get('INSTITUCION_NOMBRE', 'Centro Actoral de Boyacá');
    this.color = config.get('INSTITUCION_COLOR', '#1F3A5F');
  }

  // ------------------------------------------------------------ estadísticas
  async estadisticas(desde?: string, hasta?: string): Promise<Estadisticas> {
    const { d, h } = this.limites(desde, hasta);
    const clave = `${desde ?? ''}|${hasta ?? ''}`;
    const enCache = this.cache.get(clave);
    if (enCache && enCache.hasta > Date.now()) return enCache.datos;

    // Todas las consultas son agregadas (GROUP BY) y parametrizadas; ninguna devuelve datos personales.
    const [provincias, edades, estados, activas, meses, convocatorias] = await Promise.all([
      this.prisma.$queryRaw<{ clave: string; total: number }[]>`
        SELECT COALESCE(p.provincia, 'SIN_DATO') AS clave, COUNT(*)::int AS total
        FROM actores a JOIN perfiles_actores p ON p.actor_id = a.actor_id
        WHERE a.esta_activo
          AND (${d}::timestamp IS NULL OR a.creado_en >= ${d}::timestamp)
          AND (${h}::timestamp IS NULL OR a.creado_en <  ${h}::timestamp)
        GROUP BY 1 ORDER BY total DESC, clave`,
      this.prisma.$queryRaw<{ clave: string; total: number }[]>`
        SELECT CASE WHEN edad < 18 THEN '0-17' WHEN edad <= 25 THEN '18-25' WHEN edad <= 35 THEN '26-35'
                    WHEN edad <= 45 THEN '36-45' WHEN edad <= 60 THEN '46-60' ELSE '61+' END AS clave,
               COUNT(*)::int AS total
        FROM (
          SELECT date_part('year', age((now() AT TIME ZONE 'America/Bogota')::date, a.fecha_nacimiento))::int AS edad
          FROM actores a
          WHERE a.esta_activo
            AND (${d}::timestamp IS NULL OR a.creado_en >= ${d}::timestamp)
            AND (${h}::timestamp IS NULL OR a.creado_en <  ${h}::timestamp)
        ) t GROUP BY 1`,
      this.prisma.$queryRaw<{ clave: string; total: number }[]>`
        SELECT p.estado::text AS clave, COUNT(*)::int AS total
        FROM perfiles_actores p JOIN actores a ON a.actor_id = p.actor_id
        WHERE a.esta_activo
          AND (${d}::timestamp IS NULL OR a.creado_en >= ${d}::timestamp)
          AND (${h}::timestamp IS NULL OR a.creado_en <  ${h}::timestamp)
        GROUP BY 1`,
      this.prisma.$queryRaw<{ clave: string; total: number }[]>`
        SELECT p.estado::text AS clave, COUNT(*)::int AS total
        FROM postulaciones_castings p JOIN convocatorias c ON c.convocatoria_id = p.convocatoria_id
        WHERE p.estado IN ('POSTULADO', 'EN_REVISION', 'PRESELECCIONADO') AND c.estado IN ('ACTIVA', 'EN_PAUSA')
        GROUP BY 1`,
      this.prisma.$queryRaw<{ clave: string; total: number }[]>`
        SELECT to_char(date_trunc('month', a.creado_en), 'YYYY-MM') AS clave, COUNT(*)::int AS total
        FROM actores a
        WHERE a.esta_activo
          AND a.creado_en >= COALESCE(${d}::timestamp, date_trunc('month', now()) - interval '11 months')
          AND (${h}::timestamp IS NULL OR a.creado_en < ${h}::timestamp)
        GROUP BY 1 ORDER BY 1`,
      this.prisma.convocatorias.groupBy({ by: ['estado'], _count: { _all: true } }),
    ]);

    const totalActores = provincias.reduce((a, f) => a + f.total, 0);
    const totalPerfiles = estados.reduce((a, f) => a + f.total, 0);
    const aprobados = estados.find((f) => f.clave === 'APROBADO')?.total ?? 0;
    const totalActivas = activas.reduce((a, f) => a + f.total, 0);
    const edadPor = new Map<string, number>(edades.map((f) => [f.clave, f.total] as [string, number]));

    const datos: Estadisticas = {
      generado_en: new Date().toISOString(),
      rango: { desde: desde ?? null, hasta: hasta ?? null },
      resumen: {
        total_actores: totalActores,
        total_perfiles: totalPerfiles,
        perfiles_aprobados: aprobados,
        porcentaje_perfiles_aprobados: pct(aprobados, totalPerfiles),
        postulaciones_activas: totalActivas,
      },
      actores_por_provincia: provincias.map((f) => ({
        provincia: f.clave, etiqueta: ETIQUETA_PROVINCIA.get(f.clave) ?? f.clave, total: f.total, porcentaje: pct(f.total, totalActores),
      })),
      rangos_etarios: RANGOS_ETARIOS.map((r) => ({ rango: r, total: edadPor.get(r) ?? 0, porcentaje: pct(edadPor.get(r) ?? 0, totalActores) })),
      perfiles_por_estado: estados.map((f) => ({ estado: f.clave, total: f.total, porcentaje: pct(f.total, totalPerfiles) })),
      postulaciones_activas: { total: totalActivas, por_estado: activas.map((f) => ({ estado: f.clave, total: f.total })) },
      registros_por_mes: meses.map((f) => ({ mes: f.clave, total: f.total })),
      convocatorias_por_estado: convocatorias.map((c) => ({ estado: c.estado, total: c._count._all })),
    };

    if (this.cache.size >= 20) this.cache.clear();
    this.cache.set(clave, { hasta: Date.now() + CACHE_MS, datos });
    return datos;
  }

  // ------------------------------------------------------------ exportación
  async exportar(formato: 'csv' | 'pdf', desde: string | undefined, hasta: string | undefined, adminId: string) {
    const r = await this.estadisticas(desde, hasta);
    await this.prisma.historial_auditoria.create({
      data: {
        tipo_accion: 'ACCION_ADMINISTRADOR',
        entidad_afectada: 'reportes',
        entidad_id: adminId, // no hay una entidad concreta: se usa el id de quien exporta
        realizado_por_admin_id: adminId,
        observacion_accion: 'EXPORTAR_REPORTE',
        detalle: { accion: 'EXPORTAR_REPORTE', formato, desde: desde ?? null, hasta: hasta ?? null },
      },
    });

    const fecha = r.generado_en.slice(0, 10);
    if (formato === 'pdf') {
      return { buffer: await generarPdfReporte(r, this.institucion, this.color), contentType: 'application/pdf', nombre: `reporte-actores-${fecha}.pdf` };
    }
    const filas: unknown[][] = [
      ['seccion', 'categoria', 'valor', 'porcentaje'],
      ['metadatos', 'generado_en', r.generado_en, ''],
      ['metadatos', 'desde', r.rango.desde ?? '', ''],
      ['metadatos', 'hasta', r.rango.hasta ?? '', ''],
      ['resumen', 'total_actores', r.resumen.total_actores, ''],
      ['resumen', 'perfiles_aprobados', r.resumen.perfiles_aprobados, r.resumen.porcentaje_perfiles_aprobados],
      ['resumen', 'postulaciones_activas', r.resumen.postulaciones_activas, ''],
      ...r.actores_por_provincia.map((p) => ['actores_por_provincia', p.etiqueta, p.total, p.porcentaje]),
      ...r.rangos_etarios.map((p) => ['rangos_etarios', p.rango, p.total, p.porcentaje]),
      ...r.perfiles_por_estado.map((p) => ['perfiles_por_estado', p.estado, p.total, p.porcentaje]),
      ...r.postulaciones_activas.por_estado.map((p) => ['postulaciones_activas', p.estado, p.total, '']),
      ...r.registros_por_mes.map((p) => ['registros_por_mes', p.mes, p.total, '']),
      ...r.convocatorias_por_estado.map((p) => ['convocatorias_por_estado', p.estado, p.total, '']),
    ];
    return { buffer: Buffer.from(aCsv(filas), 'utf8'), contentType: 'text/csv; charset=utf-8', nombre: `reporte-actores-${fecha}.csv` };
  }

  /** Fechas de Colombia (UTC-5 fijo, sin horario de verano): desde inclusivo, hasta exclusivo. */
  private limites(desde?: string, hasta?: string): { d: Date | null; h: Date | null } {
    if ((desde && !parseFechaISO(desde)) || (hasta && !parseFechaISO(hasta))) {
      throw new BadRequestException('Las fechas deben ser válidas y tener formato YYYY-MM-DD');
    }
    if (desde && hasta && desde > hasta) throw new BadRequestException('"desde" no puede ser posterior a "hasta"');
    return {
      d: desde ? new Date(`${desde}T00:00:00-05:00`) : null,
      h: hasta ? new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 86_400_000) : null,
    };
  }
}
