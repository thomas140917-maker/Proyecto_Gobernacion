import PDFDocument from 'pdfkit';

/** Construye un PDF en memoria: `construir` dibuja sobre el documento y el Buffer se devuelve al final. */
export function renderPdf(
  construir: (doc: PDFKit.PDFDocument) => void | Promise<void>,
  info: PDFKit.DocumentInfo = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Creator: 'Centro Actoral de Boyacá', ...info } });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    Promise.resolve(construir(doc)).then(() => doc.end(), reject);
  });
}

/** Fecha larga en español de Colombia: "5 de octubre de 2026". */
export const fechaLarga = (d: Date) =>
  d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });
