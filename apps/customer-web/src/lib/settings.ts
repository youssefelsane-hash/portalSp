import { apiFetch } from './api-client';
import { HomepageContentDto, SupportContactDto } from './api-types';

// إعدادات عامة مُدارة من الأدمن — مفيش access_token مطلوب (Public() في الباك-إند)، نفس نمط catalog.ts.
export const fetchHomepageContent = () => apiFetch<HomepageContentDto>('/settings/homepage-content', null);

export const fetchSupportContact = () => apiFetch<SupportContactDto>('/settings/support-contact', null);
