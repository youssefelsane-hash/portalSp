import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { TechniciansService } from '../technicians/technicians.service';
import { Order } from './entities/order.entity';
import { OrderMedia, OrderMediaType } from './entities/order-media.entity';

export interface IncomingFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class OrderMediaService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderMedia) private readonly orderMedia: Repository<OrderMedia>,
    private readonly techniciansService: TechniciansService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async upload(
    userId: string,
    orderId: string,
    mediaType: OrderMediaType,
    caption: string | undefined,
    file: IncomingFile,
  ): Promise<OrderMedia> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }

    const key = `orders/${orderId}/${randomUUID()}${extname(file.originalname)}`;
    const fileUrl = await this.storage.save(key, file.buffer, file.mimetype);

    const media = this.orderMedia.create({
      orderId,
      uploadedByUserId: userId,
      mediaType,
      fileUrl,
      fileSizeBytes: file.size,
      caption: caption ?? null,
    });
    await this.orderMedia.save(media);
    return media;
  }

  listForOrder(orderId: string): Promise<OrderMedia[]> {
    return this.orderMedia.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  /**
   * إصلاح أمني (مراجعة booking flow الشاملة 2026-08-12) — كانت بَقّة حقيقية: التحكم بالطلبات
   * (`TechnicianOrderExecutionController.listMedia()`) كان بينادي `listForOrder(id)` مباشرة
   * من غير أي تحقق ملكية، يعني أي فني عنده توكن صالح يقدر يشوف صور طلب مش بتاعه لو عرف/خمّن
   * الـid (Broken Object Level Authorization) — بعكس `listQuoteItems` في نفس الـcontroller اللي
   * فعلاً بيتحقق (`listForTechnician` في order-items.service.ts). نفس النمط هنا دلوقتي.
   */
  async listForTechnician(userId: string, orderId: string): Promise<OrderMedia[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return this.listForOrder(orderId);
  }
}
