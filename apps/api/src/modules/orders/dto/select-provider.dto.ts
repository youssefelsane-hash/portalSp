import { IsUUID } from 'class-validator';

// ADR-0066 — العميل بيختار منفّذ من قايمة مرشّحي `GET /orders/:id/provider-candidates` بعد ما
// وافق على عرض السعر. السعر النهائي بيتحسب سيرفر-سايد (قيمة العرض + فرق مستوى الفني ده) —
// العميل بيبعت الفني بس، ما بيبعتش سعر.
export class SelectProviderDto {
  @IsUUID()
  technician_id: string;
}
