import { IsIn, IsOptional, Matches } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class ReporteQueryDto {
  /** Fecha de registro del actor desde (YYYY-MM-DD, hora de Colombia, inclusive). */
  @IsOptional() @Matches(FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional() @Matches(FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;
}

export class ExportReporteDto extends ReporteQueryDto {
  @IsIn(['csv', 'pdf'])
  formato: 'csv' | 'pdf';
}
