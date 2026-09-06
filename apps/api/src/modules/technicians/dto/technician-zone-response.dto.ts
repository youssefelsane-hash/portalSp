import { TechnicianZone } from '../entities/technician-zone.entity';

export interface TechnicianZoneResponseDto {
  id: string;
  technician_id: string;
  service_zone_id: string;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
}

export function toTechnicianZoneResponseDto(row: TechnicianZone): TechnicianZoneResponseDto {
  return {
    id: row.id,
    technician_id: row.technicianId,
    service_zone_id: row.serviceZoneId,
    is_primary: row.isPrimary,
    is_active: row.isActive,
    created_at: row.createdAt.toISOString(),
  };
}
