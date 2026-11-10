import {
  CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand,
  PutObjectCommand, S3Client, S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Almacenamiento S3 compatible (AWS S3 o MinIO). El bucket es PRIVADO: solo URLs firmadas. */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private readonly cliente: S3Client;
  private readonly firmador: S3Client;
  private readonly autoCrear: boolean;
  readonly ttl: number;
  private listo?: Promise<void>;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.autoCrear = config.get('S3_AUTO_CREATE_BUCKET') === 'true';
    this.ttl = Number(config.get('SIGNED_URL_TTL', 900));

    const base: S3ClientConfig = {
      region: config.getOrThrow<string>('S3_REGION'),
      // Sin claves explícitas el SDK usa la cadena por defecto (rol IAM de la tarea ECS, etc.)
      ...(config.get('S3_ACCESS_KEY') && config.get('S3_SECRET_KEY')
        ? {
            credentials: {
              accessKeyId: config.get<string>('S3_ACCESS_KEY') as string,
              secretAccessKey: config.get<string>('S3_SECRET_KEY') as string,
            },
          }
        : {}),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE') === 'true',
      maxAttempts: 4, // reintentos automáticos con backoff ante fallos transitorios
      // Compatibilidad con MinIO / S3-compatibles (el SDK nuevo añade checksums por defecto)
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    const endpoint = config.get<string>('S3_ENDPOINT') || undefined;
    const publico = config.get<string>('S3_PUBLIC_ENDPOINT') || endpoint;
    this.cliente = new S3Client({ ...base, endpoint });
    // El host de una URL firmada forma parte de la firma: se firma con el host que verá el navegador.
    this.firmador = new S3Client({ ...base, endpoint: publico });
  }

  async onModuleInit() {
    for (let intento = 1; intento <= 5; intento++) {
      try {
        await this.asegurarBucket();
        return;
      } catch (e) {
        if (intento === 5) {
          this.logger.error(`Almacenamiento no disponible: ${(e as Error).message} (se reintentará al subir)`);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private asegurarBucket(): Promise<void> {
    this.listo ??= this.verificarBucket().catch((e) => {
      this.listo = undefined;
      throw e;
    });
    return this.listo;
  }

  private async verificarBucket() {
    try {
      await this.cliente.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 && this.autoCrear) {
        await this.cliente.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" creado`);
      } else {
        throw e;
      }
    }
  }

  async subir(clave: string, cuerpo: Buffer, contentType: string) {
    await this.asegurarBucket();
    await this.cliente.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: clave, Body: cuerpo, ContentType: contentType }),
    );
  }

  /** Descarga un objeto completo en memoria (PDF, documentos). 404 si no existe. */
  async descargar(clave: string): Promise<Buffer> {
    try {
      const r = await this.cliente.send(new GetObjectCommand({ Bucket: this.bucket, Key: clave }));
      return Buffer.from(await (r.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('Archivo no disponible');
      }
      throw e;
    }
  }

  /** Borrado "mejor esfuerzo": un fallo aquí no debe tumbar la petición (queda en logs). */
  async eliminar(claves: string[]) {
    if (!claves.length) return;
    try {
      await this.cliente.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: claves.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    } catch (e) {
      this.logger.error(`No se pudieron borrar ${claves.length} objeto(s): ${(e as Error).message}`);
    }
  }

  urlFirmada(clave: string, descarga = false): Promise<string> {
    return getSignedUrl(
      this.firmador,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: clave,
        ResponseContentDisposition: descarga ? 'attachment; filename="documento.pdf"' : undefined,
      }),
      { expiresIn: this.ttl },
    );
  }
}
