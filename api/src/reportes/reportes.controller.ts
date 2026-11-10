import { Controller, Get, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExportReporteDto, ReporteQueryDto } from './dto/reportes.dto';
import { ReportesService } from './reportes.service';

@ApiTags('Reportes (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get('estadisticas')
  estadisticas(@Query() q: ReporteQueryDto) {
    return this.reportes.estadisticas(q.desde, q.hasta);
  }

  /** CSV o PDF (?formato=csv|pdf). Solo datos agregados; la exportación queda auditada. */
  @Get('estadisticas/export')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async exportar(
    @Query() q: ExportReporteDto,
    @Req() req: { admin: { sub: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.reportes.exportar(q.formato, q.desde, q.hasta, req.admin.sub);
    res.set({
      'Content-Type': r.contentType,
      'Content-Disposition': `attachment; filename="${r.nombre}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(r.buffer);
  }
}
