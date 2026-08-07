import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from './technicians.service';
import { TechnicianDocumentsService } from './technician-documents.service';
import { toTechnicianProfileResponseDto } from './dto/technician-profile-response.dto';
import { toTechnicianDocumentResponseDto } from './dto/technician-document-response.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

@Controller('technician')
@Roles(UserType.TECHNICIAN)
export class TechniciansController {
  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly technicianDocumentsService: TechnicianDocumentsService,
  ) {}

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return toTechnicianProfileResponseDto(await this.techniciansService.findByUserIdOrThrow(user.sub));
  }

  @Get('level')
  async getLevel(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    return { current_level: profile.currentLevel, quality_score: Number(profile.qualityScore) };
  }

  @Patch('availability')
  async updateAvailability(@CurrentUser() user: JwtPayload, @Body() dto: UpdateAvailabilityDto) {
    return toTechnicianProfileResponseDto(await this.techniciansService.updateAvailability(user.sub, dto));
  }

  @Post('location')
  @HttpCode(HttpStatus.OK)
  async updateLocation(@CurrentUser() user: JwtPayload, @Body() dto: UpdateLocationDto) {
    await this.techniciansService.updateLocation(user.sub, dto);
    return null;
  }

  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
    }),
  )
  async uploadDocument(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('نوع الملف غير مسموح — صور JPEG/PNG/WEBP أو PDF بس');
    }

    const document = await this.technicianDocumentsService.upload(user.sub, dto, file);
    return toTechnicianDocumentResponseDto(document);
  }

  @Get('documents')
  async listDocuments(@CurrentUser() user: JwtPayload) {
    const documents = await this.technicianDocumentsService.listMine(user.sub);
    return documents.map(toTechnicianDocumentResponseDto);
  }
}
