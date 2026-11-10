import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CastingController } from './casting.controller';
import { CastingService } from './casting.service';

@Module({ imports: [AuthModule], controllers: [CastingController], providers: [CastingService] })
export class CastingModule {}
