import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from '../technicians/technicians.service';
import { toProgressionStatusResponseDto } from './dto/progression-response.dto';
import { TechnicianProgressionService } from './technician-progression.service';

// المسار الوظيفي الشخصي للفني (docs/11 §4) — الرتبة الحالية، التقدّم للمستوى الجاي، والمتطلبات
// الناقصة. مفيش أي معلومة أدمن داخلية (سبب رفض/موافقة داخلي) بتتسرّب هنا عمدًا.
@Controller('technician/progression')
@Roles(UserType.TECHNICIAN)
export class TechnicianProgressionController {
  constructor(
    private readonly progressionService: TechnicianProgressionService,
    private readonly techniciansService: TechniciansService,
  ) {}

  @Get()
  async getMyProgression(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const { status, history } = await this.progressionService.getTechnicianSummary(profile.id);
    return {
      status: status ? toProgressionStatusResponseDto(status) : null,
      history: history.map((h) => ({
        id: h.id,
        previous_level: h.previousLevel,
        new_level: h.newLevel,
        change_type: h.changeType,
        effective_from: h.effectiveFrom.toISOString(),
      })),
    };
  }
}
