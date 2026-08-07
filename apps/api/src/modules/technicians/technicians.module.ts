import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { TechnicianProfileListener } from './technician-profile.listener';
import { TechnicianProfile } from './entities/technician-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TechnicianProfile])],
  controllers: [TechniciansController],
  providers: [TechniciansService, TechnicianProfileListener],
  exports: [TechniciansService],
})
export class TechniciansModule {}
