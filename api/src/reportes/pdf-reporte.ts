import { fechaLarga, renderPdf } from '../common/pdf.util';
import type { Estadisticas } from './reportes.service';

const ANCHO = 595.28;

export function generarPdfReporte(r: Estadisticas, institucion: string, color: string): Promise<Buffer> {
  return renderPdf(
    (doc) => {
      doc.rect(0, 0, ANCHO, 80).fill(color);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text(institucion, 50, 22, { width: ANCHO - 100 });
      doc.font('Helvetica').fontSize(11).text('Reporte estadístico del Registro Departamental de Actores', 50, 48, { width: ANCHO - 100 });

      doc.fillColor('#444444').fontSize(9).text(
        `Generado el ${fechaLarga(new Date(r.generado_en))} · Registros ${r.rango.desde ? `desde ${r.rango.desde}` : 'sin fecha inicial'} ${r.rango.hasta ? `hasta ${r.rango.hasta}` : 'hasta hoy'}`,
        50, 95, { width: ANCHO - 100 },
      );

      // ---- indicadores
      const kpis: [string, string][] = [
        ['Actores', String(r.resumen.total_actores)],
        ['Perfiles aprobados', `${r.resumen.perfiles_aprobados} (${r.resumen.porcentaje_perfiles_aprobados}%)`],
        ['Postulaciones activas', String(r.resumen.postulaciones_activas)],
      ];
      kpis.forEach(([titulo, valor], i) => {
        const x = 50 + i * 170;
        doc.roundedRect(x, 120, 160, 56, 6).lineWidth(1).strokeColor(color).stroke();
        doc.fillColor('#555555').font('Helvetica').fontSize(9).text(titulo, x + 10, 128, { width: 140 });
        doc.fillColor(color).font('Helvetica-Bold').fontSize(18).text(valor, x + 10, 146, { width: 140 });
      });
      doc.y = 200;

      const seccion = (titulo: string, filas: { etiqueta: string; total: number; porcentaje?: number }[]) => {
        if (doc.y > 700) doc.addPage();
        doc.fillColor(color).font('Helvetica-Bold').fontSize(12).text(titulo, 50, doc.y + 10);
        doc.moveDown(0.4);
        const max = Math.max(1, ...filas.map((f) => f.total));
        if (!filas.length) doc.fillColor('#777777').font('Helvetica').fontSize(9).text('Sin datos en el rango seleccionado.', 50);
        for (const f of filas) {
          if (doc.y > 770) doc.addPage();
          const y = doc.y;
          doc.fillColor('#222222').font('Helvetica').fontSize(9).text(f.etiqueta, 50, y, { width: 170 });
          doc.rect(225, y + 1, Math.max(1, (f.total / max) * 220), 9).fill(color);
          doc.fillColor('#222222').text(`${f.total}${f.porcentaje !== undefined ? ` (${f.porcentaje}%)` : ''}`, 455, y, { width: 90 });
          doc.y = y + 16;
        }
      };

      seccion('Actores por provincia', r.actores_por_provincia.map((p) => ({ etiqueta: p.etiqueta, total: p.total, porcentaje: p.porcentaje })));
      seccion('Rangos etarios (edad real)', r.rangos_etarios.map((p) => ({ etiqueta: `${p.rango} años`, total: p.total, porcentaje: p.porcentaje })));
      seccion('Estado de los perfiles', r.perfiles_por_estado.map((p) => ({ etiqueta: p.estado, total: p.total, porcentaje: p.porcentaje })));
      seccion('Postulaciones activas por estado', r.postulaciones_activas.por_estado.map((p) => ({ etiqueta: p.estado, total: p.total })));
      seccion('Registros por mes', r.registros_por_mes.map((p) => ({ etiqueta: p.mes, total: p.total })));

      doc.fillColor('#888888').fontSize(7).text(
        'Datos agregados: este reporte no contiene información personal. Postulaciones activas: POSTULADO, EN_REVISION o PRESELECCIONADO en convocatorias ACTIVA o EN_PAUSA.',
        50, 805, { width: ANCHO - 100 },
      );
    },
    { Title: 'Reporte estadístico', Author: institucion },
  );
}
