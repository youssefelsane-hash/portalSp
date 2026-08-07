import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toOrderResponseDto } from './dto/order-response.dto';
import { toOrderMediaResponseDto } from './dto/order-media-response.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { OrderMediaService } from './order-media.service';
import { OrdersService } from './orders.service';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// دورة عمل الفني على الطلب اللي اتاخده فعلاً — accept/reject نفسهم في modules/matching (بيتعاملوا مع order_assignments)
@Controller('technician/orders')
@Roles(UserType.TECHNICIAN)
export class TechnicianOrderExecutionController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderMediaService: OrderMediaService,
  ) {}

  @Post(':id/depart')
  async depart(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toOrderResponseDto(await this.ordersService.depart(user.sub, id));
  }

  @Post(':id/arrive')
  async arrive(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toOrderResponseDto(await this.ordersService.arrive(user.sub, id));
  }

  @Post(':id/start')
  async start(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toOrderResponseDto(await this.ordersService.start(user.sub, id));
  }

  @Post(':id/complete')
  async complete(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toOrderResponseDto(await this.ordersService.complete(user.sub, id));
  }

  @Post(':id/media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async uploadMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadMediaDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('نوع الملف غير مسموح — صور JPEG/PNG/WEBP بس');
    }

    const media = await this.orderMediaService.upload(user.sub, id, dto.media_type, dto.caption, file);
    return toOrderMediaResponseDto(media);
  }

  @Get(':id/media')
  async listMedia(@Param('id', ParseUUIDPipe) id: string) {
    const media = await this.orderMediaService.listForOrder(id);
    return media.map(toOrderMediaResponseDto);
  }
}
