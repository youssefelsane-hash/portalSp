import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { Service } from '../catalog/entities/service.entity';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule } from './entities/service-pricing-rule.entity';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';

/**
 * محرك تسعير حقيقي فوق نفس الـDataSource بتاع الاختبار (ADR-0060).
 *
 * قبل ADR-0060 كانت الاختبارات الحية بتمرّر `new PricingEngineService({} as never, …)` لأن
 * خدماتها كانت `fixed` والمحرك ماكانش بيتنادى أصلاً. دلوقتي كل خدمة معادلة، فأي اختبار بيمرّ
 * على `estimate()` محتاج محرك شغّال — والحل مرة واحدة هنا بدل تكرار نفس التركيب في كل ملف.
 */
export function realPricingEngineService(dataSource: DataSource): PricingEngineService {
  const auditStub = { record: async () => undefined } as unknown as AuditLogService;
  const fieldsService = new PricingFieldsService(
    dataSource.getRepository(ServicePricingField),
    dataSource.getRepository(ServicePricingRule),
    auditStub,
  );
  const rulesService = new PricingRulesService(
    dataSource.getRepository(ServicePricingRule),
    dataSource.getRepository(ServicePricingField),
    auditStub,
  );
  return new PricingEngineService(
    dataSource.getRepository(ServicePricingEvaluation),
    fieldsService,
    rulesService,
    dataSource.getRepository(Service),
  );
}
