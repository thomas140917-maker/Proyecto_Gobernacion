import { Module } from '@nestjs/common';
import { VitrinaController } from './vitrina.controller';
import { VitrinaService } from './vitrina.service';

@Module({ controllers: [VitrinaController], providers: [VitrinaService] })
export class VitrinaModule {}
