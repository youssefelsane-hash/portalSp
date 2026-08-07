import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeoModule } from '../geo/geo.module';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { CustomerProfileListener } from './customer-profile.listener';
import { Address } from './entities/address.entity';
import { CustomerProfile } from './entities/customer-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Address, CustomerProfile]), GeoModule],
  controllers: [AddressesController],
  providers: [AddressesService, CustomerProfileListener],
  exports: [AddressesService],
})
export class CustomersModule {}
