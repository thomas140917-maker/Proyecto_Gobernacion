import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Firma digital PAdES opcional. Se activa con CERT_P12_BASE64 (+ CERT_P12_PASSWORD): un .p12
 * emitido por una entidad de certificación acreditada (validez legal en Colombia).
 * Sin él, los certificados llevan la firma de integridad del sistema y se validan en línea.
 */
@Injectable()
export class FirmaPdfService {
  private readonly logger = new Logger(FirmaPdfService.name);
  private readonly p12?: Buffer;
  private readonly clave: string;

  constructor(config: ConfigService) {
    const b64 = config.get<string>('CERT_P12_BASE64');
    this.p12 = b64 ? Buffer.from(b64, 'base64') : undefined;
    this.clave = config.get<string>('CERT_P12_PASSWORD', '');
    if (this.p12) this.logger.log('Firma digital PAdES activada');
  }

  get activo(): boolean {
    return !!this.p12;
  }

  async firmar(pdf: Buffer, meta: { razon: string; contacto: string; nombre: string; lugar: string }): Promise<Buffer> {
    if (!this.p12) return pdf;
    try {
      // Carga diferida: solo se necesita cuando hay un certificado configurado.
      const { plainAddPlaceholder } = require('@signpdf/placeholder-plain');
      const { P12Signer } = require('@signpdf/signer-p12');
      const mod = require('@signpdf/signpdf');
      const signpdf = mod.default ?? mod.signpdf ?? new mod.SignPdf();

      const conMarcador = plainAddPlaceholder({
        pdfBuffer: pdf, reason: meta.razon, contactInfo: meta.contacto, name: meta.nombre, location: meta.lugar,
        signatureLength: 16384,
      });
      const firmado = await signpdf.sign(conMarcador, new P12Signer(this.p12, { passphrase: this.clave }));
      return Buffer.from(firmado);
    } catch (e) {
      // Con certificado configurado nunca se emite un PDF "sin firmar" en silencio.
      this.logger.error(`Fallo al firmar el PDF: ${(e as Error).message}`);
      throw new InternalServerErrorException('No se pudo firmar el documento; inténtalo más tarde');
    }
  }
}
