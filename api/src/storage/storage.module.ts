import { Global, Module } from '@nestjs/common';
import { ImagenService } from '../multimedia/imagen.service';
import { MiniaturasService } from './miniaturas.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [StorageService, MiniaturasService, ImagenService],
  exports: [StorageService, MiniaturasService, ImagenService],
})
export class StorageModule {}
