import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { BookingSlotSuggestionService } from './booking-slot-suggestion.service';
import { SuggestedDaysQueryDto, SuggestedTimesQueryDto } from './dto/booking-slot-suggestion.dto';

/**
 * **اقتراح المواعيد قبل الحجز** (ADR-0088، docs/08 §141).
 *
 * مسار مستقل عن `/orders` عمدًا: ده سؤال **قبل** وجود أي طلب، ومحدش بيكتب حاجة هنا. وضعه تحت
 * `/orders` كان هيخاطر بتصادم مع `/orders/:id` ويخلط «اقرا الطاقة» بـ«اعمل طلب».
 *
 * الاقتراح **مش قيد**: العميل يقدر يتجاهله ويختار أي يوم/ساعة بإيده، والتحقق الحقيقي بيحصل
 * وقت إنشاء الطلب زي ما هو بالظبط. اللي بيتغيّر هنا هو إن الخانة الفاضية بقى فيها ٣ ضغطات
 * جاهزة بدل ما العميل يخمّن.
 */
@Controller('booking-slots')
@Roles(UserType.CUSTOMER)
export class BookingSlotsController {
  constructor(private readonly suggestions: BookingSlotSuggestionService) {}

  @Get('days')
  async days(@CurrentUser() user: JwtPayload, @Query() query: SuggestedDaysQueryDto) {
    const result = await this.suggestions.suggestDays({
      customerUserId: user.sub,
      serviceId: query.service_id,
      addressId: query.address_id,
      durationMinutes: query.duration_minutes ?? null,
      estimatedDurationDays: query.estimated_duration_days ?? null,
    });
    return {
      days: result.days.map((day) => ({
        day: day.day,
        available_technicians: day.availableTechnicians,
        is_earliest: day.isEarliest,
      })),
      lead_hours: result.leadHours,
      horizon_days: result.horizonDays,
    };
  }

  @Get('times')
  async times(@CurrentUser() user: JwtPayload, @Query() query: SuggestedTimesQueryDto) {
    const result = await this.suggestions.suggestTimes({
      customerUserId: user.sub,
      serviceId: query.service_id,
      addressId: query.address_id,
      day: query.day,
      durationMinutes: query.duration_minutes ?? null,
    });
    return { times: result.times.map((slot) => ({ time: slot.time, free_technicians: slot.freeTechnicians })) };
  }
}
