import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CandidatosQueryDto } from './casting.dto';
import { CastingService } from './casting.service';

@ApiTags('Casting (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('convocatorias/:id')
export class CastingController {
  constructor(private readonly casting: CastingService) {}

  /** Tablero: postulaciones agrupadas por estado (POSTULADO ... RECHAZADO). */
  @Get('kanban')
  kanban(@Param('id', ParseUUIDPipe) id: string) {
    return this.casting.kanban(id);
  }

  /** Actores sugeridos para la convocatoria, ordenados por compatibilidad. */
  @Get('candidatos-sugeridos')
  candidatos(@Param('id', ParseUUIDPipe) id: string, @Query() q: CandidatosQueryDto) {
    return this.casting.candidatos(id, q);
  }
}
