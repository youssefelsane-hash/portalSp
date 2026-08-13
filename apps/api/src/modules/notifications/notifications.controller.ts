import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { toNotificationResponseDto, toUserDeviceResponseDto } from './dto/notification-response.dto';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { NotificationChannel } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

// كل الـ endpoints هنا متاحة لأي مستخدم مسجّل دخول (عميل/فني/أدمن) — مفيش @Roles لأن
// الإشعارات والأجهزة خاصية شخصية بحتة، مقيّدة بـ user_id مش بنوع المستخدم.
@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('devices')
  async registerDevice(@CurrentUser() user: JwtPayload, @Body() dto: RegisterDeviceDto) {
    return toUserDeviceResponseDto(await this.notificationsService.registerDevice(user.sub, dto));
  }

  @Delete('devices/:deviceId')
  async deactivateDevice(@CurrentUser() user: JwtPayload, @Param('deviceId') deviceId: string) {
    await this.notificationsService.deactivateDevice(user.sub, deviceId);
    return { device_id: deviceId, is_active: false };
  }

  @Get('notifications')
  async listMine(@CurrentUser() user: JwtPayload, @Query() query: ListNotificationsQueryDto) {
    const { items, meta } = await this.notificationsService.listMine(user.sub, {
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
      unreadOnly: query.unread_only ?? false,
    });
    return { items: items.map(toNotificationResponseDto), meta };
  }

  @Get('notifications/unread-count')
  async unreadCount(@CurrentUser() user: JwtPayload) {
    return { unread_count: await this.notificationsService.unreadCount(user.sub) };
  }

  @Patch('notifications/:id/read')
  async markRead(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toNotificationResponseDto(await this.notificationsService.markRead(user.sub, id));
  }

  @Patch('notifications/read-all')
  async markAllRead(@CurrentUser() user: JwtPayload) {
    return { updated_count: await this.notificationsService.markAllRead(user.sub) };
  }

  // تفضيلات إشعارات المستخدم بالقناة (docs/10 بند 37) — مستوى القناة بس (push/sms/whatsapp/email).
  @Get('me/notification-preferences')
  async listMyPreferences(@CurrentUser() user: JwtPayload) {
    const prefs = await this.notificationsService.listMyPreferences(user.sub);
    return prefs.map((p) => ({ channel: p.channel, is_enabled: p.isEnabled }));
  }

  @Patch('me/notification-preferences/:channel')
  async updateMyPreference(
    @CurrentUser() user: JwtPayload,
    @Param('channel', new ParseEnumPipe(NotificationChannel)) channel: NotificationChannel,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    await this.notificationsService.setMyPreference(user.sub, channel, dto.is_enabled);
    return { channel, is_enabled: dto.is_enabled };
  }
}
