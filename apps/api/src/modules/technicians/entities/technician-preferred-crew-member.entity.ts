import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum PreferredCrewMemberStatus {
  INVITED = 'invited',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  REMOVED = 'removed',
}

// مطابق بالحرف لـ infra/migrations/0159_preferred_crew_members.sql (ADR-0022) — شبكة تفضيل
// نظير-لنظير دائمة، اتجاه واحد بس (owner→member)، صفر موافقة أدمن. منفصلة تمامًا عن
// order_team_members/technician_companies/assistant_technician_id.
@Entity('technician_preferred_crew_members')
export class TechnicianPreferredCrewMember {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'owner_technician_id', type: 'uuid' })
  ownerTechnicianId: string;

  @Column({ name: 'member_technician_id', type: 'uuid' })
  memberTechnicianId: string;

  @Column({
    type: 'enum',
    enum: PreferredCrewMemberStatus,
    enumName: 'preferred_crew_member_status',
    default: PreferredCrewMemberStatus.INVITED,
  })
  status: PreferredCrewMemberStatus;

  @Column({ name: 'invited_at', type: 'timestamptz' })
  invitedAt: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
