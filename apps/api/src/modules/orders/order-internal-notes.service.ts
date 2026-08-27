import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OrderInternalNote } from './entities/order-internal-note.entity';

export interface OrderInternalNoteWithAuthor {
  id: string;
  orderId: string;
  authorUserId: string;
  authorFullName: string;
  note: string;
  createdAt: Date;
}

// ملاحظات داخلية على الطلب لمركز الاتصال (docs/08 §73 بند 3) — قراءة/كتابة بس، صفر منطق حالة/
// انتقال. العميل/الفني مالهومش أي endpoint بيوصل للجدول ده خالص (مش مسألة فلترة زي
// is_internal_note في الشكاوى — الجدول ده أصلاً مش متاح غير من AdminOrdersController).
@Injectable()
export class OrderInternalNotesService {
  constructor(
    @InjectRepository(OrderInternalNote) private readonly notes: Repository<OrderInternalNote>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async add(orderId: string, authorUserId: string, note: string): Promise<OrderInternalNote> {
    const entity = this.notes.create({ orderId, authorUserId, note });
    return this.notes.save(entity);
  }

  // اسم الكاتب مباشرة في نفس الاستعلام (join على users) — نفس فلسفة Timeline card، مش N+1 lookup منفصل.
  async list(orderId: string): Promise<OrderInternalNoteWithAuthor[]> {
    const rows = await this.dataSource.query<
      { id: string; order_id: string; author_user_id: string; author_full_name: string; note: string; created_at: Date }[]
    >(
      `SELECT n.id, n.order_id, n.author_user_id, u.full_name AS author_full_name, n.note, n.created_at
       FROM order_internal_notes n
       JOIN users u ON u.id = n.author_user_id
       WHERE n.order_id = $1
       ORDER BY n.created_at DESC`,
      [orderId],
    );
    return rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      authorUserId: r.author_user_id,
      authorFullName: r.author_full_name,
      note: r.note,
      createdAt: r.created_at,
    }));
  }
}
