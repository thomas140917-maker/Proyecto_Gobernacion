import { existsSync } from 'fs';
import * as QRCode from 'qrcode';
import { fechaLarga, renderPdf } from '../common/pdf.util';
import { formatearCodigo } from './utilidades';

export interface Institucion {
  nombre: string;
  firmante: string;
  cargo: string;
  color: string; // #RRGGBB
  logoPath?: string;
}

export interface DatosPdfCertificado {
  tipo: 'REGISTRO' | 'CURSO';
  nombre: string;
  tipo_documento: string;
  documento: string;
  codigo: string;
  url_verificacion: string;
  emitido_en: Date;
  vence_en: Date | null;
  firma_corta: string; // primeros caracteres de la firma de integridad
  firmado_pades: boolean;
  curso?: { titulo: string; tipo: string; horas: number | null; inicio: Date; fin: Date };
  institucion: Institucion;
}

const ANCHO = 595.28;

/** PDF institucional (A4) con QR de verificación. Solo texto estándar (Helvetica incluida en PDF). */
export async function generarPdfCertificado(d: DatosPdfCertificado): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.url_verificacion, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 320 });
  const inst = d.institucion;
  const titulo = d.tipo === 'REGISTRO' ? 'CERTIFICADO DE REGISTRO' : 'CONSTANCIA DE FORMACIÓN';

  return renderPdf(
    (doc) => {
      // ---- encabezado
      doc.rect(0, 0, ANCHO, 100).fill(inst.color);
      if (inst.logoPath && existsSync(inst.logoPath)) {
        try { doc.image(inst.logoPath, 50, 20, { fit: [90, 60] }); } catch { /* logo inválido: se omite */ }
      }
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(inst.nombre, 50, 28, { align: 'center', width: ANCHO - 100 });
      doc.font('Helvetica').fontSize(11).text('Registro Departamental de Actores de Boyacá', 50, 60, { align: 'center', width: ANCHO - 100 });

      // ---- título
      doc.fillColor(inst.color).font('Helvetica-Bold').fontSize(22).text(titulo, 50, 150, { align: 'center', width: ANCHO - 100 });
      doc.moveTo(180, 188).lineTo(ANCHO - 180, 188).lineWidth(1.5).strokeColor(inst.color).stroke();

      // ---- cuerpo
      doc.fillColor('#222222').font('Helvetica').fontSize(12).text('Se certifica que', 50, 215, { align: 'center', width: ANCHO - 100 });
      doc.font('Helvetica-Bold').fontSize(22).text(d.nombre, 50, 240, { align: 'center', width: ANCHO - 100 });
      doc.font('Helvetica').fontSize(12)
        .text(`identificado(a) con ${d.tipo_documento} No. ${d.documento}`, 50, 282, { align: 'center', width: ANCHO - 100 });

      let cuerpo: string;
      if (d.tipo === 'REGISTRO') {
        cuerpo =
          'se encuentra INSCRITO(A) y con perfil APROBADO en el Registro Departamental de Actores de Boyacá, ' +
          `administrado por ${inst.nombre}. La vigencia de este certificado puede comprobarse en línea con el código QR.`;
      } else {
        const c = d.curso!;
        cuerpo =
          `completó satisfactoriamente el ${c.tipo === 'TALLER' ? 'taller' : 'curso'} “${c.titulo}”` +
          `${c.horas ? `, con una intensidad de ${c.horas} horas,` : ''} realizado entre el ${fechaLarga(c.inicio)} y el ${fechaLarga(c.fin)}.`;
      }
      doc.fontSize(12).text(cuerpo, 90, 325, { align: 'center', width: ANCHO - 180, lineGap: 4 });

      doc.fontSize(11).fillColor('#444444')
        .text(`Expedido el ${fechaLarga(d.emitido_en)}${d.vence_en ? ` · Vigente hasta el ${fechaLarga(d.vence_en)}` : ''}`,
          50, 430, { align: 'center', width: ANCHO - 100 });

      // ---- verificación (QR + código)
      doc.image(qr, 60, 520, { width: 130 });
      doc.fillColor('#222222').font('Helvetica-Bold').fontSize(10).text('Verifica este documento', 205, 528);
      doc.font('Helvetica').fontSize(9).fillColor('#444444')
        .text('Escanea el código QR o ingresa en:', 205, 544)
        .fillColor('#0B5394').text(d.url_verificacion, 205, 558, { width: 330 });
      doc.fillColor('#222222').font('Helvetica-Bold').fontSize(11).text(`Código: ${formatearCodigo(d.codigo)}`, 205, 590);
      doc.font('Helvetica').fontSize(8).fillColor('#666666').text(`Firma de integridad: ${d.firma_corta}…`, 205, 610);
      doc.text(d.firmado_pades ? 'Documento firmado digitalmente (PAdES).' : 'Documento firmado electrónicamente por el sistema; su validez se verifica en línea.', 205, 622, { width: 330 });

      // ---- firmante
      doc.moveTo(330, 735).lineTo(ANCHO - 60, 735).lineWidth(0.8).strokeColor('#555555').stroke();
      doc.fillColor('#222222').font('Helvetica-Bold').fontSize(10).text(inst.firmante, 330, 741, { width: ANCHO - 390, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#555555').text(inst.cargo, 330, 755, { width: ANCHO - 390, align: 'center' });

      doc.fontSize(7).fillColor('#999999').text(
        'Este certificado es válido únicamente si la verificación en línea muestra el estado VIGENTE.',
        50, 800, { align: 'center', width: ANCHO - 100 },
      );
    },
    { Title: titulo, Author: inst.nombre, Subject: `Código ${d.codigo}` },
  );
}
