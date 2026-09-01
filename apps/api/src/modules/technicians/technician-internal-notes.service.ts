import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TechnicianInternalNote } from './entities/technician-internal-note.entity';

export interface TechnicianInternalNoteWithAuthor {
  id: string;
  technicianId: string;
  authorUserId: string;
  authorFullName: string;
  note: string;
  createdAt: Date;
}

@Injectable()
export class TechnicianInternalNotesService {
  constructor(
    @InjectRepository(TechnicianInternalNote) private readonly notes: Repository<TechnicianInternalNote>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async add(technicianId: string, authorUserId: string, note: string): Promise<TechnicianInternalNote> {
    const entity = this.notes.create({ technicianId, authorUserId, note: note.trim() });
    return this.notes.save(entity);
  }

  async list(technicianId: string): Promise<TechnicianInternalNoteWithAuthor[]> {
    const rows = await this.dataSource.query<
      {
        id: string;
        technician_id: string;
        author_user_id: string;
        author_full_name: string;
        note: string;
        created_at: Date;
      }[]
    >(
      `SELECT n.id, n.technician_id, n.author_user_id, u.full_name AS author_full_name,
              n.note, n.created_at
       FROM technician_internal_notes n
       JOIN users u ON u.id = n.author_user_id
       WHERE n.technician_id = $1
       ORDER BY n.created_at DESC`,
      [technicianId],
    );

    return rows.map((row) => ({
      id: row.id,
      technicianId: row.technician_id,
      authorUserId: row.author_user_id,
      authorFullName: row.author_full_name,
      note: row.note,
      createdAt: row.created_at,
    }));
  }
}
