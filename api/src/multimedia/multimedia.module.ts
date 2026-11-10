import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MultimediaController } from './multimedia.controller';
import { MultimediaService } from './multimedia.service';

@Module({
  imports: [AuthModule],
  controllers: [MultimediaController],
  providers: [MultimediaService],
})
export class MultimediaModule {}
