import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { toTechnicianKpiSnapshotResponseDto } from './dto/technician-kpi-response.dto';
import { TechnicianKpiService } from './technician-kpi.service';

// ملخّص الـKPI الشخصي للفني (docs/11 §3) — بيعرض بس الشهور اللي وصلت approved/paid/rejected،
// مفيش أي "درجة داخلية" أو ملاحظات أدمن تتسرّب إلا لو kpi.expose_approval_notes_to_technician مفعّلة.
@Controller('technician/kpi')
@Roles(UserType.TECHNICIAN)
export class TechnicianKpiController {
  constructor(
    private readonly kpiService: TechnicianKpiService,
    private readonly techniciansService: TechniciansService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async getMySummary(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const { latest, history } = await this.kpiService.getTechnicianSummary(profile.id);
    const exposeNotes = await this.settings.getBoolean('kpi.expose_approval_notes_to_technician', false);
    return {
      latest: latest ? toTechnicianKpiSnapshotResponseDto(latest, { includeApprovalNotes: exposeNotes }) : null,
      history: history.map((s) => toTechnicianKpiSnapshotResponseDto(s, { includeApprovalNotes: exposeNotes })),
    };
  }
}
