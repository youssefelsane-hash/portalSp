import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ApiException, ErrorCode } from "../../common/exceptions/api.exception";
import { resolveAvatarUrl } from "../../common/storage/resolve-avatar-url";
import {
  STORAGE_SERVICE,
  StorageService,
} from "../../common/storage/storage.service";
import { CustomerProfilesService } from "../customers/customer-profiles.service";
import { MatchingService } from "../matching/matching.service";
import { CandidateOperationalLoad } from "../technicians/technician-day-capacity.sql";
import { SettingsService } from "../settings/settings.service";
import { TechniciansService } from "../technicians/technicians.service";
import { CreateBookingMatchPreviewDto } from "./dto/create-booking-match-preview.dto";
import { PreviewOrderDto } from "./dto/preview-order.dto";
import { PreviewOrderResponseDto } from "./dto/preview-order-response.dto";
import { BookingMatchPreview } from "./entities/booking-match-preview.entity";
import { BookingMode, Order, OrderType } from "./entities/order.entity";
import { OrdersService } from "./orders.service";
import {
  bookingContextHashWithoutProvider,
  bookingFingerprintInput,
  bookingMatchContextHash,
} from "./booking-match-context";

const MATCH_PREVIEW_TTL_SECONDS_FALLBACK = 300;
const MATCH_PREVIEW_CANDIDATE_LIMIT_FALLBACK = 25;

export interface BookingMatchPreviewResponse {
  match_preview_id: string;
  expires_at: string;
  selection_mode: "auto" | "manual";
  provider: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    current_level: string;
    average_rating: number;
    total_ratings_count: number;
    completed_orders_count: number;
    distance_km: number;
  };
  pricing: PreviewOrderResponseDto;
}

@Injectable()
export class BookingMatchPreviewService {
  constructor(
    @InjectRepository(BookingMatchPreview)
    private readonly previews: Repository<BookingMatchPreview>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly ordersService: OrdersService,
    private readonly matchingService: MatchingService,
    private readonly techniciansService: TechniciansService,
    private readonly settingsService: SettingsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async create(
    userId: string,
    dto: CreateBookingMatchPreviewDto,
  ): Promise<BookingMatchPreviewResponse> {
    if (dto.request_remote_quote) {
      throw new ApiException(
        ErrorCode.VAL_001,
        "اختيار الفني يتم بعد اعتماد عرض سعر التقييم بالصور، مش قبل التقييم",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.selection_mode === "manual" && !dto.technician_id) {
      throw new ApiException(
        ErrorCode.VAL_001,
        "اختيار فني بعينه يحتاج technician_id",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.selection_mode === "auto" && dto.technician_id) {
      throw new ApiException(
        ErrorCode.VAL_001,
        "المطابقة التلقائية لا تقبل technician_id",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.requested_technician_company_id || dto.schedule_slot_id) {
      throw new ApiException(
        ErrorCode.VAL_001,
        "معاينة المطابقة تختار فنيًا واحدًا؛ لا تجمعها مع شركة أو سلوت فني آخر",
        HttpStatus.BAD_REQUEST,
      );
    }

    const customer = await this.customerProfiles.findByUserIdOrThrow(userId);
    const pricingInput = this.toPricingInput(dto);
    const neutralPricing = await this.ordersService.previewPrice(
      userId,
      pricingInput,
    );
    const previewLoad: CandidateOperationalLoad = {
      durationMinutes: neutralPricing.duration_minutes,
      estimatedDurationDays: neutralPricing.estimated_duration_days,
    };
    const candidateLimit = Math.max(
      1,
      Math.min(
        100,
        await this.settingsService.getNumber(
          "booking.match_preview_candidate_limit",
          MATCH_PREVIEW_CANDIDATE_LIMIT_FALLBACK,
        ),
      ),
    );

    const initialOrder = this.toEphemeralOrder(pricingInput, neutralPricing);
    const initialCandidates =
      await this.matchingService.findEligibleTechnicians(
        initialOrder,
        dto.selection_mode === "manual" ? 1 : candidateLimit,
        dto.selection_mode === "manual" ? dto.technician_id! : null,
        false,
        null,
        false,
        previewLoad,
      );

    let chosen: (typeof initialCandidates)[number] | null = null;
    let finalPricing: PreviewOrderResponseDto | null = null;
    for (const candidate of initialCandidates) {
      const exactInput: PreviewOrderDto = {
        ...pricingInput,
        requested_technician_id: candidate.technician_id,
      };
      const exactPricing = await this.ordersService.previewPrice(
        userId,
        exactInput,
      );
      const exactOrder = this.toEphemeralOrder(exactInput, exactPricing);
      const stillEligible = await this.matchingService.findEligibleTechnicians(
        exactOrder,
        1,
        candidate.technician_id,
        false,
        null,
        false,
        {
          durationMinutes: exactPricing.duration_minutes,
          estimatedDurationDays: exactPricing.estimated_duration_days,
        },
      );
      if (stillEligible.length === 0) continue;
      chosen = candidate;
      finalPricing = exactPricing;
      break;
    }

    if (!chosen || !finalPricing) {
      throw new ApiException(
        ErrorCode.ORDR_001,
        dto.selection_mode === "manual"
          ? "الفني المختار غير متاح أو غير مؤهل لهذا الحجز حاليًا"
          : "لا يوجد فني متاح ومؤهل لهذا الحجز حاليًا",
        HttpStatus.CONFLICT,
      );
    }

    const technician = await this.techniciansService.getPublicProfile(
      chosen.technician_id,
    );
    const ttlSeconds = Math.max(
      30,
      Math.min(
        1_800,
        await this.settingsService.getNumber(
          "booking.match_preview_ttl_seconds",
          MATCH_PREVIEW_TTL_SECONDS_FALLBACK,
        ),
      ),
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);
    const exactInput: PreviewOrderDto = {
      ...pricingInput,
      requested_technician_id: chosen.technician_id,
    };
    const contextHash = bookingMatchContextHash(
      exactInput,
      dto.selection_mode,
      chosen.technician_id,
    );

    const preview = await this.previews.manager.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${customer.id}:${dto.service_id}:${dto.address_id}`],
      );
      await manager.update(
        BookingMatchPreview,
        {
          customerId: customer.id,
          serviceId: dto.service_id,
          addressId: dto.address_id,
          status: "active",
        },
        { status: "stale" },
      );
      return manager.save(
        manager.create(BookingMatchPreview, {
          customerId: customer.id,
          orderId: null,
          serviceId: dto.service_id,
          addressId: dto.address_id,
          technicianId: chosen!.technician_id,
          technicianCompanyId: chosen!.company_id,
          selectionMode: dto.selection_mode,
          contextHash,
          // migration 0256 — نفس المدخلات اللي البصمة اتحسبت منها، عشان الرفض يبقى قابل للتشخيص.
          fingerprintInput: bookingFingerprintInput(exactInput),
          // ADR-0065 §4 — بصمة الشغلانة نفسها، عشان إعادة اختيار المنفّذ تقدر تتأكد إن التذكرة
          // الجديدة لنفس الحجز.
          bookingContextHash: bookingContextHashWithoutProvider(exactInput),
          pricingSnapshot: finalPricing! as unknown as Record<string, unknown>,
          finalPriceCents: finalPricing!.total_amount_cents,
          status: "active",
          expiresAt,
          consumedAt: null,
        }),
      );
    });

    return {
      match_preview_id: preview.id,
      expires_at: preview.expiresAt.toISOString(),
      selection_mode: preview.selectionMode,
      provider: {
        id: technician.profile.id,
        full_name: technician.fullName,
        avatar_url: await resolveAvatarUrl(
          this.storage,
          technician.avatarUrl,
          technician.avatarStorageKey,
        ),
        current_level: technician.profile.currentLevel,
        average_rating: Number(technician.profile.averageRating),
        total_ratings_count: technician.profile.totalRatingsCount,
        completed_orders_count: technician.profile.completedOrdersCount,
        distance_km: Number(chosen.distance_km),
      },
      pricing: finalPricing,
    };
  }

  private toPricingInput(dto: CreateBookingMatchPreviewDto): PreviewOrderDto {
    const {
      selection_mode: _selectionMode,
      technician_id: _technicianId,
      ...pricingInput
    } = dto;
    return { ...pricingInput, requested_technician_id: undefined };
  }

  private toEphemeralOrder(
    dto: PreviewOrderDto,
    pricing: PreviewOrderResponseDto,
  ): Order {
    return Object.assign(new Order(), {
      id: randomUUID(),
      serviceId: dto.service_id,
      addressId: dto.address_id,
      serviceZoneId: pricing.service_zone_id,
      bookingMode: pricing.booking_mode as BookingMode,
      orderType:
        pricing.booking_mode === BookingMode.EMERGENCY
          ? OrderType.EMERGENCY
          : OrderType.STANDARD,
      scheduledAt: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
      totalAmountCents: pricing.total_amount_cents,
      requiredTechnicians: pricing.required_technicians,
      requiredAssistants: pricing.required_assistants,
      durationMinutes: pricing.duration_minutes,
      estimatedDurationDays: pricing.estimated_duration_days,
    });
  }
}
