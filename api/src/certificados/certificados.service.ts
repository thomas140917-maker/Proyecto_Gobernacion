import {
  ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, certificados, tipo_certificado_enum } from '@prisma/client';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { calcularEdad } from '../common/fechas';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FirmaPdfService } from './firma-pdf.service';
import { Institucion, generarPdfCertificado } from './pdf-certificado';
import {
  CODIGO_REGEX, CargaFirma, enmascararDocumento, firmaEsValida, firmar, formatearCodigo,
  generarCodigo, nombrePublico, normalizarCodigo,
} from './utilidades';

const REUSO_HORAS = 24; // un certificado de registro emitido hace menos de 24 h se vuelve a entregar

export interface PdfEntregado {
  buffer: Buffer;
  codigo: string;
}

@Injectable()
export class CertificadosService {
  private readonly logger = new Logger(CertificadosService.name);
  private readonly secreto: string;
  private readonly vigenciaDias: number;
  private readonly baseVerificacion: string;
  private readonly institucion: Institucion;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly firmaPdf: FirmaPdfService,
    config: ConfigService,
  ) {
    this.secreto = config.getOrThrow<string>('CERT_HMAC_SECRET');
    this.vigenciaDias = Math.max(1, Number(config.get('CERT_VIGENCIA_DIAS', 90)) || 90);
    this.baseVerificacion = (config.get<string>('VERIFY_BASE_URL') || `${config.getOrThrow<string>('FRONTEND_URL')}/verificar`).replace(/\/+$/, '');
    const logo = config.get<string>('INSTITUCION_LOGO_PATH') || join(process.cwd(), 'assets', 'logo.png');
    this.institucion = {
      nombre: config.get('INSTITUCION_NOMBRE', 'Centro Actoral de Boyacá'),
      firmante: config.get('INSTITUCION_FIRMANTE', 'Dirección del Centro Actoral'),
      cargo: config.get('INSTITUCION_CARGO', 'Director(a)'),
      color: config.get('INSTITUCION_COLOR', '#1F3A5F'),
      logoPath: existsSync(logo) ? logo : undefined,
    };
  }

  // ------------------------------------------------------------ emisión
  /** Certificado de registro: solo con perfil APROBADO y cuenta activa. */
  async emitirRegistro(actorId: string): Promise<PdfEntregado> {
    const actor = await this.prisma.actores.findUnique({
      where: { actor_id: actorId },
      select: {
        actor_id: true, esta_activo: true, nombre_completo: true, tipo_documento: true, numero_documento: true,
        perfil: { select: { estado: true } },
      },
    });
    if (!actor?.esta_activo) throw new ForbiddenException('Cuenta no habilitada');
    if (actor.perfil?.estado !== 'APROBADO') {
      throw new ForbiddenException('Podrás obtener el certificado cuando tu perfil esté aprobado');
    }

    const ahora = new Date();
    const reciente = await this.prisma.certificados.findFirst({
      where: {
        actor_id: actorId, tipo: 'REGISTRO', revocado_en: null,
        vence_en: { gt: ahora }, emitido_en: { gt: new Date(ahora.getTime() - REUSO_HORAS * 3_600_000) },
      },
      orderBy: { emitido_en: 'desc' },
    });
    if (reciente) return this.entregar(reciente);

    return this.crear({
      tipo: 'REGISTRO',
      actor,
      cursoId: null,
      datos: { titular: actor.nombre_completo, tipo_documento: actor.tipo_documento, documento: actor.numero_documento },
      vence: new Date(ahora.getTime() + this.vigenciaDias * 86_400_000),
    });
  }

  /** Constancia de curso: solo si el admin marcó la inscripción como COMPLETADA. */
  async emitirCurso(actorId: string, cursoId: string): Promise<PdfEntregado> {
    const insc = await this.prisma.inscripciones_curso.findUnique({
      where: { curso_id_actor_id: { curso_id: cursoId, actor_id: actorId } },
      include: {
        curso: true,
        actor: { select: { actor_id: true, esta_activo: true, nombre_completo: true, tipo_documento: true, numero_documento: true } },
      },
    });
    if (!insc || insc.estado !== 'COMPLETADA' || !insc.actor.esta_activo) {
      throw new ForbiddenException('Solo puedes obtener la constancia de un curso que completaste');
    }
    const existente = await this.prisma.certificados.findFirst({
      where: { actor_id: actorId, curso_id: cursoId, tipo: 'CURSO', revocado_en: null },
    });
    if (existente) return this.entregar(existente);

    const c = insc.curso;
    return this.crear({
      tipo: 'CURSO',
      actor: insc.actor,
      cursoId,
      datos: {
        titular: insc.actor.nombre_completo, tipo_documento: insc.actor.tipo_documento, documento: insc.actor.numero_documento,
        curso: { titulo: c.titulo, tipo: c.tipo, horas: c.horas_totales, inicio: c.fecha_inicio_curso.toISOString(), fin: (c.fecha_fin_curso ?? c.fecha_inicio_curso).toISOString() },
      },
      vence: null,
    });
  }

  private async crear(p: {
    tipo: tipo_certificado_enum;
    actor: { actor_id: string; nombre_completo: string; tipo_documento: string; numero_documento: string };
    cursoId: string | null;
    datos: Prisma.InputJsonObject;
    vence: Date | null;
  }): Promise<PdfEntregado> {
    const codigo = generarCodigo();
    const emitido = new Date();
    const carga: CargaFirma = {
      codigo, tipo: p.tipo, actor_id: p.actor.actor_id, curso_id: p.cursoId, emitido_en: emitido, vence_en: p.vence, datos: p.datos,
    };
    const firma = firmar(carga, this.secreto);

    const d = p.datos as { curso?: { titulo: string; tipo: string; horas: number | null; inicio: string; fin: string } };
    const base = await generarPdfCertificado({
      tipo: p.tipo,
      nombre: p.actor.nombre_completo,
      tipo_documento: p.actor.tipo_documento,
      documento: p.actor.numero_documento,
      codigo,
      url_verificacion: `${this.baseVerificacion}/${codigo}`,
      emitido_en: emitido,
      vence_en: p.vence,
      firma_corta: firma.slice(0, 16),
      firmado_pades: this.firmaPdf.activo,
      curso: d.curso ? { ...d.curso, inicio: new Date(d.curso.inicio), fin: new Date(d.curso.fin) } : undefined,
      institucion: this.institucion,
    });
    const pdf = await this.firmaPdf.firmar(base, {
      razon: p.tipo === 'REGISTRO' ? 'Certificado de registro' : 'Constancia de formación',
      contacto: this.institucion.nombre, nombre: this.institucion.firmante, lugar: 'Boyacá, Colombia',
    });
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const clave = `certificados/${p.actor.actor_id}/${codigo}.pdf`;
    await this.storage.subir(clave, pdf, 'application/pdf');

    try {
      await this.prisma.$transaction(async (tx) => {
        const fila = await tx.certificados.create({
          data: {
            codigo, tipo: p.tipo, actor_id: p.actor.actor_id, curso_id: p.cursoId, emitido_en: emitido,
            vence_en: p.vence, datos: p.datos, firma, sha256, clave_pdf: clave,
          },
        });
        await tx.historial_auditoria.create({
          data: {
            tipo_accion: 'CREAR',
            entidad_afectada: 'certificados',
            entidad_id: fila.certificado_id,
            realizado_por_actor_id: p.actor.actor_id,
            observacion_accion: `Emisión de certificado ${p.tipo}`,
            detalle: { codigo, tipo: p.tipo, curso_id: p.cursoId },
          },
        });
      });
    } catch (e) {
      await this.storage.eliminar([clave]); // sin PDF huérfano
      // Dos solicitudes simultáneas de la misma constancia: se entrega la que ganó
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && p.cursoId) {
        const ganadora = await this.prisma.certificados.findFirst({
          where: { actor_id: p.actor.actor_id, curso_id: p.cursoId, tipo: 'CURSO', revocado_en: null },
        });
        if (ganadora) return this.entregar(ganadora);
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('No se pudo emitir el certificado; inténtalo de nuevo');
      }
      throw e;
    }
    return { buffer: pdf, codigo };
  }

  private async entregar(fila: certificados): Promise<PdfEntregado> {
    return { buffer: await this.storage.descargar(fila.clave_pdf), codigo: fila.codigo };
  }

  // ------------------------------------------------------------ consulta y descarga
  async mios(actorId: string) {
    const filas = await this.prisma.certificados.findMany({
      where: { actor_id: actorId }, orderBy: { emitido_en: 'desc' }, take: 100,
    });
    const ahora = new Date();
    return filas.map((f) => ({
      certificado_id: f.certificado_id,
      codigo: formatearCodigo(f.codigo),
      tipo: f.tipo,
      curso: (f.datos as { curso?: { titulo: string } }).curso?.titulo ?? null,
      emitido_en: f.emitido_en,
      vence_en: f.vence_en,
      estado: f.revocado_en ? 'REVOCADO' : f.vence_en && f.vence_en <= ahora ? 'VENCIDO' : 'EMITIDO',
    }));
  }

  async descargar(id: string, usuario: { tipo: 'ADMIN' | 'ACTOR'; id: string }): Promise<PdfEntregado> {
    const fila = await this.prisma.certificados.findUnique({ where: { certificado_id: id } });
    // Un actor solo ve los suyos; para él, el ajeno "no existe"
    if (!fila || (usuario.tipo === 'ACTOR' && fila.actor_id !== usuario.id)) throw new NotFoundException('Certificado no encontrado');
    if (fila.revocado_en && usuario.tipo === 'ACTOR') throw new ConflictException('Este certificado fue revocado');
    return this.entregar(fila);
  }

  // ------------------------------------------------------------ revocación (admin)
  async revocar(id: string, adminId: string, motivo: string) {
    return this.prisma.$transaction(async (tx) => {
      const fila = await tx.certificados.findUnique({ where: { certificado_id: id } });
      if (!fila) throw new NotFoundException('Certificado no encontrado');
      const ahora = new Date();
      const r = await tx.certificados.updateMany({
        where: { certificado_id: id, revocado_en: null },
        data: { revocado_en: ahora, motivo_revocacion: motivo, revocado_por_admin_id: adminId },
      });
      if (r.count !== 1) throw new ConflictException('El certificado ya estaba revocado');
      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ACCION_ADMINISTRADOR',
          entidad_afectada: 'certificados',
          entidad_id: id,
          realizado_por_admin_id: adminId,
          observacion_accion: 'REVOCAR_CERTIFICADO',
          detalle: { accion: 'REVOCAR', codigo: fila.codigo, motivo },
        },
      });
      return { certificado_id: id, codigo: formatearCodigo(fila.codigo), estado: 'REVOCADO', revocado_en: ahora };
    });
  }

  // ------------------------------------------------------------ verificación pública
  /**
   * Responde si el código corresponde a un certificado auténtico y vigente. Es público:
   * solo expone nombre (abreviado si es menor), documento enmascarado, fechas y estado.
   */
  async verificar(codigoCrudo: string) {
    const codigo = normalizarCodigo(codigoCrudo);
    if (!CODIGO_REGEX.test(codigo)) throw new NotFoundException('Código no encontrado');

    const fila = await this.prisma.certificados.findUnique({
      where: { codigo },
      include: { actor: { select: { esta_activo: true, fecha_nacimiento: true, perfil: { select: { estado: true } } } } },
    });
    if (!fila) throw new NotFoundException('Código no encontrado');

    const carga: CargaFirma = {
      codigo: fila.codigo, tipo: fila.tipo, actor_id: fila.actor_id, curso_id: fila.curso_id,
      emitido_en: fila.emitido_en, vence_en: fila.vence_en, datos: fila.datos,
    };
    const ahora = new Date();
    let estado: string;
    if (!firmaEsValida(carga, fila.firma, this.secreto)) {
      this.logger.warn(`Integridad comprometida en el certificado ${fila.certificado_id}`);
      estado = 'INTEGRIDAD_COMPROMETIDA';
    } else if (fila.revocado_en) estado = 'REVOCADO';
    else if (fila.vence_en && fila.vence_en <= ahora) estado = 'VENCIDO';
    else if (fila.tipo === 'REGISTRO' && (!fila.actor.esta_activo || fila.actor.perfil?.estado !== 'APROBADO')) estado = 'NO_VIGENTE_REGISTRO';
    else estado = 'VIGENTE';

    if (estado === 'INTEGRIDAD_COMPROMETIDA') {
      return { codigo: formatearCodigo(fila.codigo), valido: false, estado, verificado_en: ahora };
    }
    const d = fila.datos as { titular: string; tipo_documento: string; documento: string; curso?: { titulo: string; tipo: string; horas: number | null; inicio: string; fin: string } };
    return {
      codigo: formatearCodigo(fila.codigo),
      valido: estado === 'VIGENTE',
      estado,
      tipo: fila.tipo,
      titular: nombrePublico(d.titular, calcularEdad(fila.actor.fecha_nacimiento) < 18),
      tipo_documento: d.tipo_documento,
      documento: enmascararDocumento(d.documento),
      emitido_en: fila.emitido_en,
      vence_en: fila.vence_en,
      curso: d.curso ?? null,
      hash_documento_sha256: fila.sha256, // permite comprobar con `sha256sum` que el PDF no fue alterado
      verificado_en: ahora,
    };
  }
}
