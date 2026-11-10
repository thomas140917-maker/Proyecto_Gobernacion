import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

/** URLs firmadas de la miniatura de FOTO_PERFIL para varios actores con UNA sola consulta. */
@Injectable()
export class MiniaturasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async deActores(actorIds: string[]): Promise<Map<string, string>> {
    if (!actorIds.length) return new Map();
    const filas = await this.prisma.archivos_multimedia.findMany({
      where: {
        actor_id: { in: actorIds },
        tipo_archivo: 'FOTO_PERFIL',
        almacenamiento: 'S3',
        url_miniatura: { not: null },
      },
      select: { actor_id: true, url_miniatura: true },
    });
    const pares = await Promise.all(
      filas.map(async (f) => [f.actor_id, await this.storage.urlFirmada(f.url_miniatura as string)] as const),
    );
    return new Map(pares);
  }
}
