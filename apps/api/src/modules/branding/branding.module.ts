import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { AuditModule } from '../audit/audit.module';
import { AdminBrandingController } from './admin-branding.controller';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { BrandingAsset } from './entities/branding-asset.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BrandingAsset]), AuditModule],
  controllers: [BrandingController, AdminBrandingController],
  providers: [BrandingService, RedisCacheService, storageServiceProvider],
  exports: [BrandingService],
})
export class BrandingModule {}
