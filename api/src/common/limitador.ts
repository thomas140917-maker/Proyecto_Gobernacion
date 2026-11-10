import { ServiceUnavailableException } from '@nestjs/common';

/** Semáforo con cola acotada: limita trabajos pesados simultáneos (p. ej. Sharp). */
export class Limitador {
  private activos = 0;
  private readonly cola: Array<() => void> = [];

  constructor(
    private readonly maxSimultaneos: number,
    private readonly maxCola: number,
  ) {}

  async ejecutar<T>(tarea: () => Promise<T>): Promise<T> {
    if (this.activos >= this.maxSimultaneos) {
      if (this.cola.length >= this.maxCola) {
        throw new ServiceUnavailableException('Servidor ocupado procesando archivos, intenta de nuevo en unos segundos');
      }
      // El cupo se hereda al liberarse: nunca se supera maxSimultaneos.
      await new Promise<void>((resolver) => this.cola.push(resolver));
    } else {
      this.activos++;
    }
    try {
      return await tarea();
    } finally {
      const siguiente = this.cola.shift();
      if (siguiente) siguiente();
      else this.activos--;
    }
  }
}
