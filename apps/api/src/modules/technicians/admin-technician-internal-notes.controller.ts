import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AddTechnicianInternalNoteDto } from './dto/add-technician-internal-note.dto';
import { TechnicianInternalNotesService } from './technician-internal-notes.service';

@Controller('admin/technicians')
@Roles(UserType.ADMIN)
export class AdminTechnicianInternalNotesController {
  constructor(private readonly notes: TechnicianInternalNotesService) {}

  @Get(':id/notes')
  async list(@Param('id', ParseUUIDPipe) id: string) {
    const notes = await this.notes.list(id);
    return notes.map((note) => ({
      id: note.id,
      technician_id: note.technicianId,
      author_user_id: note.authorUserId,
      author_full_name: note.authorFullName,
      note: note.note,
      created_at: note.createdAt.toISOString(),
    }));
  }

  @Post(':id/notes')
  async add(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTechnicianInternalNoteDto,
  ) {
    const note = await this.notes.add(id, admin.sub, dto.note);
    return {
      id: note.id,
      technician_id: note.technicianId,
      author_user_id: note.authorUserId,
      note: note.note,
      created_at: note.createdAt.toISOString(),
    };
  }
}
