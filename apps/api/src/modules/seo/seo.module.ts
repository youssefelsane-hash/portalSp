import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Service } from '../catalog/entities/service.entity';
import { Area } from '../geo/entities/area.entity';
import { City } from '../geo/entities/city.entity';
import { SeoController } from './seo.controller';
import { SeoService } from './seo.service';

/**
 * **موديول الظهور في البحث** (ADR-0113).
 *
 * بيقرا `services` و`areas` و`cities` **مباشرةً** بلا ما يستورد `CatalogModule` أو `GeoModule`:
 * المطلوب هنا تلات استعلامات قراءة على حقول معدودة، واستيراد الموديولين كان بيجرّ كل تبعياتهم
 * (تسعير، نطاقات، تجاوزات كتالوج) لموديول مالوش أي علاقة بيهم — وبيفتح باب دايرة مستقبلية.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Service, Area, City])],
  controllers: [SeoController],
  providers: [SeoService],
  exports: [SeoService],
})
export class SeoModule {}
