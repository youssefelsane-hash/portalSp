import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { Complaint } from '../support/entities/complaint.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, TechnicianProfile, Complaint, Rating])],
  controllers: [AdminReportsController],
  providers: [AdminReportsService],
})
export class AdminModule {}
