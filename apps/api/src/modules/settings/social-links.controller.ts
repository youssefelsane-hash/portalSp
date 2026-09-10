import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';

/**
 * الشبكات اللي المنصة بتعلن عنها. الترتيب هنا هو ترتيب العرض في الفوتر — مصدر واحد بدل
 * ما الويب يرتّبهم بنفسه ويختلف عن أي سطح تاني بعدين.
 */
const NETWORKS = ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube'] as const;

export type SocialNetwork = (typeof NETWORKS)[number];

export interface SocialLinkDto {
  network: SocialNetwork;
  url: string;
}

export interface SocialLinksResponseDto {
  /** الحسابات المضبوطة فقط، بترتيب العرض. فاضية لو الأدمن لسه ما ملاش أي حاجة. */
  links: SocialLinkDto[];
}

/**
 * روابط السوشيال ميديا الرسمية (docs/08 §136، طلب مالك 2026-09-10).
 *
 * **ليه الـendpoint ده موجود أصلاً**: المالك دوّر في المشروع على Facebook/Instagram ولقى إن
 * مفيش أي إعداد ليهم خالص. من غير ده، أي أيقونة سوشيال في الفوتر كانت هتبقى رابط مكتوب في
 * الكود — تغييره يحتاج deploy، وده بالظبط اللي `settings` موجود عشان يمنعه.
 *
 * **`@Public()` عمدًا** — نفس فلسفة `LegalEntityController`/`SupportContactController`: الفوتر
 * بيتعرض على كل صفحة **قبل أي تسجيل دخول**.
 *
 * **`https://` فقط، والباقي بيتشال**: القيمة دي بتتحوّل لـ`href` بيتنفّذ على متصفح المستخدم،
 * فأي حاجة تانية (`javascript:`، `data:`) كانت هتبقى ثغرة. والحارس هنا مش في مسار الأدمن عمدًا:
 * القراءة هي المسار اللي فعليًا بيبني الرابط، فهي المكان الصح للتحقق (نفس درس
 * `SupportContactController.help_url` بالحرف).
 *
 * **الفاضي بيختفي مش بيرجع سلسلة فاضية**: الواجهة مالهاش تقرر «ده رابط ولا لأ» — العقد نفسه
 * بيرجّع المضبوط بس، فمستحيل تتعرض أيقونة بتودّي لحتة فاضية.
 */
@Controller('social-links')
export class SocialLinksController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get()
  async get(): Promise<SocialLinksResponseDto> {
    const values = await Promise.all(
      NETWORKS.map((network) => this.settingsService.getString(`social.${network}_url`, '')),
    );

    const links: SocialLinkDto[] = [];
    NETWORKS.forEach((network, index) => {
      const url = values[index].trim();
      if (url.startsWith('https://')) links.push({ network, url });
    });

    return { links };
  }
}
