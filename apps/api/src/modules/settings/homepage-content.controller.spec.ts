import { HomepageContentController } from './homepage-content.controller';
import { SettingsService } from './settings.service';

describe('HomepageContentController hero images', () => {
  it('returns only the first four safe image URLs in admin order', async () => {
    const settings = {
      getString: jest.fn().mockResolvedValue('رسالة ثقة'),
      getJson: jest.fn(async (key: string) => {
        if (key === 'homepage.search_content') {
          return {
            eyebrow: '  اعمل إيه؟  ',
            title: 'اكتب المشكلة',
            description: '',
            placeholder: 'مثال: الحنفية بتسرب',
          };
        }
        if (key === 'homepage.hero_images') {
          return [
            ' https://cdn.example.com/one.jpg ',
            'javascript:alert(1)',
            '/uploads/home/two.webp',
            42,
            'http://insecure.example.com/three.jpg',
            'https://cdn.example.com/three.jpg',
            'https://cdn.example.com/four.jpg',
            'https://cdn.example.com/five.jpg',
          ];
        }
        return [];
      }),
    } as unknown as SettingsService;

    const response = await new HomepageContentController(settings).getHomepageContent();

    expect(response.hero_images).toEqual([
      'https://cdn.example.com/one.jpg',
      '/uploads/home/two.webp',
      'https://cdn.example.com/three.jpg',
      'https://cdn.example.com/four.jpg',
    ]);
    expect(response.search).toEqual({
      eyebrow: 'اعمل إيه؟',
      title: 'اكتب المشكلة',
      description: 'قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت',
      placeholder: 'مثال: الحنفية بتسرب',
    });
  });
});
