import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0366_client_error_events.sql (ADR-0114)
@Entity('client_error_events')
export class ClientErrorEvent {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'text' })
  app: string;

  @Column({ type: 'text' })
  kind: string;

  /** المسار المطهّر — `/orders/:id/rate` مش `/orders/01a0…/rate`. */
  @Column({ name: 'page_path', type: 'text' })
  pagePath: string;

  @Column({ name: 'error_name', type: 'text', nullable: true })
  errorName: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'component_stack', type: 'text', nullable: true })
  componentStack: string | null;

  @Column({ name: 'api_path', type: 'text', nullable: true })
  apiPath: string | null;

  @Column({ name: 'api_status', type: 'int', nullable: true })
  apiStatus: number | null;

  @Column({ type: 'text', nullable: true })
  browser: string | null;

  @Column({ type: 'text', nullable: true })
  os: string | null;

  @Column({ name: 'device_kind', type: 'text', nullable: true })
  deviceKind: string | null;

  @Column({ type: 'text' })
  fingerprint: string;

  @Column({ name: 'visitor_hash', type: 'text', nullable: true })
  visitorHash: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
