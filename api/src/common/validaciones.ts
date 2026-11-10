import { BadRequestException } from '@nestjs/common';

/** La edad aparente se indica como rango completo (mín y máx) o no se indica. */
export function validarEdadAparente(min?: number | null, max?: number | null) {
  const hayMin = min !== undefined && min !== null;
  const hayMax = max !== undefined && max !== null;
  if (hayMin !== hayMax) {
    throw new BadRequestException('Indica edad_aparente_min y edad_aparente_max juntas, o ninguna');
  }
  if (hayMin && min! > max!) {
    throw new BadRequestException('edad_aparente_min no puede ser mayor que edad_aparente_max');
  }
}
