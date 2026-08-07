import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocalDiskStorageService } from '../../common/storage/local-disk-storage.service';
import { STORAGE_SERVICE } from '../../common/storage/storage.service';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { AdminTechniciansController } from './admin-technicians.controller';
import { AdminTechniciansService } from './admin-technicians.service';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { TechnicianDocumentsService } from './technician-documents.service';
import { TechnicianProfileListener } from './technician-profile.listener';
import { TechnicianDocument } from './entities/technician-document.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TechnicianProfile, TechnicianDocument, User]), AuditModule],
  controllers: [TechniciansController, AdminTechniciansController],
  providers: [
    TechniciansService,
    TechnicianProfileListener,
    TechnicianDocumentsService,
    AdminTechniciansService,
    { provide: STORAGE_SERVICE, useClass: LocalDiskStorageService },
  ],
  exports: [TechniciansService],
})
export class TechniciansModule {}
