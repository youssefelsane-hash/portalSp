import { ApiException } from '../../common/exceptions/api.exception';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';

describe('TechniciansService.updateProfile() — النبذة المهنية العامة', () => {
  function createService(initialBio: string | null = null) {
    const profile = { bio: initialBio } as TechnicianProfile;
    const technicianProfiles = { save: jest.fn(async (value: TechnicianProfile) => value) };
    const service = Object.create(TechniciansService.prototype) as TechniciansService;
    Object.assign(service, { technicianProfiles });
    jest.spyOn(service, 'findByUserIdOrThrow').mockResolvedValue(profile);
    return { service, profile, technicianProfiles };
  }

  it('يحفظ نبذة مهنية سليمة بعد إزالة المسافات الزائدة', async () => {
    const { service, profile } = createService();

    await expect(service.updateProfile('user-1', { bio: '  فني تكييف بخبرة 8 سنوات في الصيانة والتركيب  ' })).resolves.toBe(profile);

    expect(profile.bio).toBe('فني تكييف بخبرة 8 سنوات في الصيانة والتركيب');
  });

  it.each([
    'كلمني على 01012345678',
    'راسلني على tech@example.com',
    'شوف شغلي على https://example.com',
    'واتساب: ٠١٠١٢٣٤٥٦٧٨',
  ])('يرفض وسيلة التواصل الشخصية: %s', async (bio) => {
    const { service, technicianProfiles } = createService();

    await expect(service.updateProfile('user-1', { bio })).rejects.toBeInstanceOf(ApiException);
    expect(technicianProfiles.save).not.toHaveBeenCalled();
  });

  it('يسمح بمسح النبذة', async () => {
    const { service, profile } = createService('نبذة قديمة');

    await service.updateProfile('user-1', { bio: '   ' });

    expect(profile.bio).toBeNull();
  });
});
