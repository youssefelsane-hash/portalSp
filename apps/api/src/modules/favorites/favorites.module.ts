import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { CustomerFavoriteTechnician } from './entities/customer-favorite-technician.entity';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerFavoriteTechnician, TechnicianProfile])],
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
