import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { CustomerFavoriteTechnician } from './entities/customer-favorite-technician.entity';

export interface FavoriteTechnicianSummary {
  technicianId: string;
  fullName: string;
  avatarUrl: string | null;
  averageRating: number;
  totalRatingsCount: number;
  completedOrdersCount: number;
  favoritedAt: Date;
}

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(CustomerFavoriteTechnician)
    private readonly favorites: Repository<CustomerFavoriteTechnician>,
    @InjectRepository(TechnicianProfile)
    private readonly technicianProfiles: Repository<TechnicianProfile>,
  ) {}

  async addFavorite(customerUserId: string, technicianId: string): Promise<void> {
    const technician = await this.technicianProfiles.findOne({ where: { id: technicianId } });
    if (!technician) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }

    const existing = await this.favorites.findOne({ where: { customerUserId, technicianId } });
    if (existing) {
      // Idempotent — تفضيل فني اتفضّل بالفعل مش خطأ، مجرد no-op.
      return;
    }

    await this.favorites.insert({ customerUserId, technicianId });
  }

  async removeFavorite(customerUserId: string, technicianId: string): Promise<void> {
    await this.favorites.delete({ customerUserId, technicianId });
  }

  async isFavorited(customerUserId: string, technicianId: string): Promise<boolean> {
    const count = await this.favorites.count({ where: { customerUserId, technicianId } });
    return count > 0;
  }

  async listFavorites(customerUserId: string): Promise<FavoriteTechnicianSummary[]> {
    interface Row {
      technician_id: string;
      full_name: string;
      avatar_url: string | null;
      average_rating: string;
      total_ratings_count: number;
      completed_orders_count: number;
      favorited_at: Date;
    }

    const rows = await this.favorites.manager.query<Row[]>(
      `SELECT
         cft.technician_id,
         u.full_name,
         u.avatar_url,
         tp.average_rating,
         tp.total_ratings_count,
         tp.completed_orders_count,
         cft.created_at AS favorited_at
       FROM customer_favorite_technicians cft
       JOIN technician_profiles tp ON tp.id = cft.technician_id
       JOIN users u ON u.id = tp.user_id
       WHERE cft.customer_user_id = $1
       ORDER BY cft.created_at DESC`,
      [customerUserId],
    );

    return rows.map((row) => ({
      technicianId: row.technician_id,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      averageRating: Number(row.average_rating),
      totalRatingsCount: row.total_ratings_count,
      completedOrdersCount: row.completed_orders_count,
      favoritedAt: row.favorited_at,
    }));
  }
}
