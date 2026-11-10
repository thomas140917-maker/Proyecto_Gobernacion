import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { VitrinaQueryDto } from './dto/vitrina.dto';
import { VitrinaService } from './vitrina.service';

/** Público (sin login). Limitado por IP para dificultar el raspado masivo. */
@ApiTags('Vitrina pública')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('vitrina')
export class VitrinaController {
  constructor(private readonly vitrina: VitrinaService) {}

  @Get('actores')
  buscar(@Query() q: VitrinaQueryDto) {
    return this.vitrina.buscar(q);
  }

  @Get('actores/:id')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.vitrina.obtener(id);
  }

  /** Valores disponibles para armar los filtros del buscador. */
  @Get('filtros')
  @Header('Cache-Control', 'public, max-age=300')
  filtros() {
    return this.vitrina.filtros();
  }
}
