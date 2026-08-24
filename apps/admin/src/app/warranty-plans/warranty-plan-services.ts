export interface ServiceOption {
  id: string;
  name_ar: string;
}

export type ServicesResponse = ServiceOption[] | { items?: ServiceOption[] };

export function normalizeServiceOptions(response: ServicesResponse): ServiceOption[] {
  if (Array.isArray(response)) return response;
  return Array.isArray(response.items) ? response.items : [];
}
