import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { toCancellationReasonResponseDto } from './dto/cancellation-reason-response.dto';
import { ListCancellationReasonsDto } from './dto/list-cancellation-reasons.dto';
import { CancellationReasonsService } from './cancellation-reasons.service';

// عامة تماماً — قايمة أسباب إلغاء بس، مفيش بيانات حساسة، والعميل/الفني الاتنين محتاجينها
// كقايمة اختيار قبل ما يلغوا طلب (applies_to بيفرّق بينهم).
@Controller('cancellation-reasons')
export class CancellationReasonsController {
  constructor(private readonly cancellationReasonsService: CancellationReasonsService) {}

  @Public()
  @Get()
  async list(@Query() query: ListCancellationReasonsDto) {
    const reasons = await this.cancellationReasonsService.listActive(query.applies_to);
    return reasons.map(toCancellationReasonResponseDto);
  }
}
