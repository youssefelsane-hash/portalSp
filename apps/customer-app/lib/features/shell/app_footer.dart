import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_config.dart';
import '../../core/auth_gate.dart';
import '../catalog/categories_screen.dart';
import '../projects/my_projects_screen.dart';
import '../support/complaints_screen.dart';
import '../support/support_contact_screen.dart';
import 'site_info_repository.dart';

/// فوتر التطبيق — **النظير الحرفي لفوتر الموقع** (`apps/customer-web/src/components/site-footer.tsx`).
///
/// بلاغ المالك (2026-09-11): «الفوتر أصلاً مش ظاهر في الـcustomer application». وده كان صح:
/// المحتوى القانوني والروابط كانوا مدفونين جوّه «حسابي ← الشروط والسياسات»، يعني الزائر اللي
/// لسه ما سجّلش — وهو بالظبط اللي محتاج يشوف حقوق الملكية وسياسة الخصوصية قبل ما يثق — مكانش
/// بيوصلهم خالص.
///
/// **نفس تلات طبقات الويب بالحرف**، لأن نفس المبدأ اللي خلّى فوتر الويب «بريميوم» هو اللي
/// ينفع هنا: العلامة والتواصل (الأثقل) ← التنقّل ← شريط قانوني رفيع فيه الشروط والخصوصية
/// وحذف الحساب. حذف الحساب **هنا** مش كزرار بارز — نفس القرار اللي اتاخد على الويب.
///
/// **النص القانوني مابيتنسخش**: الروابط بتفتح صفحات الموقع، ومصدر النص الوحيد هو
/// `apps/customer-web/src/lib/legal-content.ts`. نسخة تانية جوّه التطبيق معناها مستندين
/// قانونيين لازم يتزامنوا يدويًا — وأول ما يختلفوا، واحد فيهم بيبقى كذب.
class AppFooter extends StatefulWidget {
  const AppFooter({super.key, this.zoneId});

  /// منطقة الخدمة الحالية — بتتمرّر لشاشة الفئات عشان تعرض المتاح فعلاً في مكان العميل.
  final String? zoneId;

  @override
  State<AppFooter> createState() => _AppFooterState();
}

class _AppFooterState extends State<AppFooter> {
  final _repository = SiteInfoRepository();
  LegalEntityInfo _entity = LegalEntityInfo.fallback;
  List<SocialLink> _social = const [];

  /// الموقع مشتق من عنوان الـAPI — نفس مبدأ `LegalLinksScreen`، فمفيش دومين تاني مكتوب في
  /// الكود لازم يتحدّث لوحده لما البيئة تتغيّر.
  static String get _siteOrigin =>
      apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final entity = await _repository.legalEntity();
    final social = await _repository.socialLinks();
    if (!mounted) return;
    setState(() {
      _entity = entity;
      _social = social;
    });
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('مقدرناش نفتح $uri')));
    }
  }

  Future<void> _push(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  /// شاشات محتاجة حساب — نفس بوابة `ensureSignedIn` المستخدمة في كل مسار حجز، عشان الزائر
  /// ما يوصلش لشاشة فاضية بيقوله «سجّل دخولك» بعد ما يكون ضغط.
  Future<void> _pushGuarded(Widget screen, String reason) async {
    if (!await ensureSignedIn(context, reason: reason)) return;
    if (!mounted) return;
    await _push(screen);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final year = DateTime.now().year;

    return Container(
      width: double.infinity,
      color: theme.colorScheme.surfaceContainerLowest,
      padding: const EdgeInsets.fromLTRB(16, 28, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── الطبقة الأولى: العلامة ─────────────────────────────────────────
          Text(
            _entity.platformNameAr,
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
              color: theme.colorScheme.primary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'صنايعية معتمدين لكل شغلانة في البيت — سعر واضح قبل ما تبدأ، تتبّع لحظي، ودفع آمن.',
            style: theme.textTheme.bodySmall?.copyWith(color: muted, height: 1.6),
          ),

          if (_social.isNotEmpty) ...[
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final link in _social)
                  OutlinedButton(
                    onPressed: () => _openUrl(link.url),
                    style: OutlinedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 6,
                      ),
                    ),
                    // اسم الشبكة كنص مش أيقونة براند: Material مافيهاش أيقونات براندات، وأي
                    // أيقونة بديلة بتبقى تخمين بصري غلط. النص أوضح وأصدق.
                    child: Text(
                      socialLabelsAr[link.network] ?? link.network,
                      style: theme.textTheme.labelMedium,
                    ),
                  ),
              ],
            ),
          ],

          if (_entity.supportPhone != null || _entity.supportEmail != null) ...[
            const SizedBox(height: 14),
            if (_entity.supportPhone != null)
              _FooterLink(
                label: _entity.supportPhone!,
                ltr: true,
                onTap: () => _openUrl('tel:${_entity.supportPhone}'),
              ),
            if (_entity.supportEmail != null)
              _FooterLink(
                label: _entity.supportEmail!,
                ltr: true,
                onTap: () => _openUrl('mailto:${_entity.supportEmail}'),
              ),
          ],

          const SizedBox(height: 22),
          Divider(height: 1, color: theme.dividerColor),
          const SizedBox(height: 18),

          // ── الطبقة الثانية: التنقّل ────────────────────────────────────────
          // عمودين بدل تلاتة: عرض الموبايل مابيسمحش بتلاتة من غير ما الأسماء تتقصّ.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _FooterColumn(
                  title: 'أسطى',
                  children: [
                    _FooterLink(
                      label: 'كل الفئات',
                      onTap: () => _push(CategoriesScreen(zoneId: widget.zoneId)),
                    ),
                    _FooterLink(
                      label: 'مشاريعي',
                      onTap: () => _pushGuarded(
                        const MyProjectsScreen(),
                        'مشاريعك بتتحفظ على حسابك عشان تتابع مراحلها.',
                      ),
                    ),
                    _FooterLink(
                      label: 'من نحن',
                      external: true,
                      onTap: () => _openUrl('$_siteOrigin/about'),
                    ),
                    _FooterLink(
                      label: 'انضم كمقدم خدمة',
                      external: true,
                      onTap: () => _openUrl('$_siteOrigin/join'),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: _FooterColumn(
                  title: 'الدعم',
                  children: [
                    _FooterLink(
                      label: 'تواصل معنا',
                      onTap: () => _push(const SupportContactScreen()),
                    ),
                    _FooterLink(
                      label: 'الشكاوى',
                      onTap: () => _pushGuarded(
                        const ComplaintsScreen(),
                        'الشكاوى مرتبطة بطلباتك، فمحتاجين نعرف حسابك.',
                      ),
                    ),
                    // نص قانوني قايم بالفعل — الربط بالـanchor بيوصّل لمحتوى حقيقي بدل صفحة
                    // تسويقية فاضية بتقول نفس الكلام بصياغة تانية (وتتعارض معاه بعدين).
                    _FooterLink(
                      label: 'الضمان',
                      external: true,
                      onTap: () => _openUrl('$_siteOrigin/legal/terms#section-10'),
                    ),
                    _FooterLink(
                      label: 'الإلغاء والاسترداد',
                      external: true,
                      onTap: () => _openUrl('$_siteOrigin/legal/terms#section-9'),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 22),
          Divider(height: 1, color: theme.dividerColor),
          const SizedBox(height: 16),

          // ── الطبقة الثالثة: الشريط القانوني ────────────────────────────────
          // أخف وزن في الشاشة كلها، **وده مكان حذف الحساب** — نفس قرار الويب بالحرف.
          Wrap(
            spacing: 14,
            runSpacing: 6,
            children: [
              _LegalLink(
                label: 'شروط الاستخدام',
                onTap: () => _openUrl('$_siteOrigin/legal/terms'),
              ),
              _LegalLink(
                label: 'سياسة الخصوصية',
                onTap: () => _openUrl('$_siteOrigin/legal/privacy'),
              ),
              _LegalLink(
                label: 'حذف الحساب',
                onTap: () => _openUrl('$_siteOrigin/legal/account-deletion'),
              ),
            ],
          ),

          const SizedBox(height: 14),
          DefaultTextStyle(
            style:
                theme.textTheme.bodySmall?.copyWith(color: muted, height: 1.7) ??
                TextStyle(color: muted),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('© $year ${_entity.companyNameEn} — جميع الحقوق محفوظة.'),
                Text(
                  '${_entity.platformNameAr} (${_entity.platformNameEn}) — تُدار بواسطة '
                  '${_entity.companyNameAr} — ${_entity.companyNameEn}',
                ),
                if (_entity.legalAddress != null) Text(_entity.legalAddress!),
                if (_entity.commercialRegister != null)
                  Text('السجل التجاري: ${_entity.commercialRegister}'),
                if (_entity.taxId != null) Text('الرقم الضريبي: ${_entity.taxId}'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _FooterColumn extends StatelessWidget {
  const _FooterColumn({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        ...children,
      ],
    );
  }
}

class _FooterLink extends StatelessWidget {
  const _FooterLink({
    required this.label,
    required this.onTap,
    this.external = false,
    this.ltr = false,
  });

  final String label;
  final VoidCallback onTap;
  final bool external;
  final bool ltr;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final text = Text(
      label,
      style: theme.textTheme.bodyMedium,
      textDirection: ltr ? TextDirection.ltr : null,
    );
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: external
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(child: text),
                  const SizedBox(width: 4),
                  Icon(
                    Icons.open_in_new,
                    size: 13,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ],
              )
            : text,
      ),
    );
  }
}

class _LegalLink extends StatelessWidget {
  const _LegalLink({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}
