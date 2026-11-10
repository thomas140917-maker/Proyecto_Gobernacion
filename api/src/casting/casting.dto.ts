import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginacionDto } from '../admin/dto/admin.dto';

export class CandidatosQueryDto extends PaginacionDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  min_compatibilidad?: number = 0;
}
