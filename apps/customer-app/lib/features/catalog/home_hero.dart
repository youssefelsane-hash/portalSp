import 'package:flutter/material.dart';

import '../../design/app_theme.dart';
import 'hero_image_crossfade.dart';
import 'homepage_content_repository.dart';

/// **بَقّة حقيقية اتلقطت من المالك على الجهاز (docs/08 §76-ب)**: ارتفاع الـhero كان
/// `SizedBox(height:)` مقفول. تصغيره من 300 لـ200 (طلب مالك) خلّى محتواه (عنوان + وصف + شريط
/// بحث + سطر الضمان + النقط) أطول من الصندوق، فطلع `BOTTOM OVERFLOWED BY 43 PIXELS` — الشرايط
/// الصفرا والسودا اللي المالك شافها جنب محرك البحث بالظبط.
///
/// **الإصلاح من الجذر مش بتكبير الرقم**: الارتفاع بقى **حد أدنى** (`minHeight`) والـ`Stack`
/// بيتمدد لمحتواه. يعني الصورة ليها مساحة مضمونة زي ما المالك طلب، وفي نفس الوقت أي نص أطول
/// (عنوان أطول من الأدمن، مقياس خط أكبر من إعدادات الجهاز) بياخد مساحته بدل ما يعمل overflow.
/// رقم ثابت كان هيفضل قنبلة موقوتة مهما كبّرناه.
const double kHeroMinHeight = 200;

const List<List<Color>> _kHeroGradients = [
  [Color(0xFF1C3A6E), Color(0xFF2F5AA6), Color(0xFF4D78C4)],
  [Color(0xFF0F1115), Color(0xFF22314F), Color(0xFF2F5AA6)],
  [Color(0xFF2F5AA6), Color(0xFF4D78C4), Color(0xFF7FA6E0)],
];

/// عدد التدرّجات الاحتياطية — الشاشة الرئيسية بتستخدمه عشان تعرف كام "شريحة" تلفّ عليها لما
/// مفيش صور مرفوعة من الأدمن.
int get heroFallbackSlideCount => _kHeroGradients.length;

/// لوحة الـhero في الشاشة الرئيسية — صورة + عنوان + شريط بحث + سطر الضمان.
///
/// **ليه ودجت مستقلة مش دالة جوّه `HomeScreen`؟** لأن الشكل ده هو اللي بَقّة الـoverflow
/// طلعت منه، ودالة خاصة جوّه شاشة بتنادي الشبكة والتخزين ما ينفعش تتقاس في اختبار. الودجت
/// دي مدخلاتها كلها معطيات بسيطة، فاختبار بيقدر يرسمها بمقاييس خط وعروض مختلفة ويتأكد إن
/// مفيش overflow — وده اللي بيمنع البَقّة ترجع تاني.
class HomeHero extends StatelessWidget {
  const HomeHero({
    super.key,
    required this.images,
    required this.activeIndex,
    required this.content,
    required this.trustMessage,
    required this.onSearch,
  });

  final List<ImageProvider<Object>> images;
  final int activeIndex;
  final HomepageSearchContent content;
  final String trustMessage;
  final ValueChanged<String> onSearch;

  @override
  Widget build(BuildContext context) {

    final effectiveImages = images;
    final gradientIndex = activeIndex % _kHeroGradients.length;
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: kHeroMinHeight),
      child: Stack(
        // مفيش `StackFit.expand` هنا عمدًا: الـStack بياخد حجمه من الطفل غير المُموضَع (طبقة
        // النص/البحث)، وطبقات الصورة والتدرّج بتتمدد ليه بـ`Positioned.fill`. ده اللي بيخلّي
        // الارتفاع يتبع المحتوى بدل ما المحتوى يتحشر في ارتفاع مفروض عليه ويعمل overflow.
        children: [
          Positioned.fill(
            child: HeroImageCrossfade(
              images: effectiveImages,
              activeIndex: activeIndex,
              fallback: AnimatedContainer(
                // التدرّج بيتحرّك بس لما هو نفسه الخلفية المعروضة. لما فيه صور، هو مجرد شبكة
                // أمان تحتها فمفيش داعي يستهلك فريمات في أنيميشن محدش شايفه.
                duration: Duration(
                  milliseconds: effectiveImages.isEmpty ? 1000 : 0,
                ),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: _kHeroGradients[gradientIndex],
                  ),
                ),
              ),
            ),
          ),
          // تدرّج قراءة: غامق تحت وشفاف فوق — أخف من الصندوق القديم بكتير، فالصورة بانت.
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.72),
                    Colors.black.withValues(alpha: 0.28),
                    Colors.transparent,
                  ],
                  stops: const [0, 0.6, 1],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 26, 20, 18),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: 1),
              duration: const Duration(milliseconds: 700),
              curve: Curves.easeOutCubic,
              builder: (context, value, child) => Opacity(
                opacity: value,
                child: Transform.translate(
                  offset: Offset(0, 16 * (1 - value)),
                  child: child,
                ),
              ),
              child: Column(
                // `min` مقصود: العمود بياخد ارتفاع محتواه بالظبط، والـ`ConstrainedBox` فوق
                // بيضمن الحد الأدنى. `end` مع ارتفاع مقفول كان بيدفع المحتوى لتحت **ويقصّه**
                // بدل ما يوسّع الصندوق.
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // `content.eyebrow` («أساعدك إزاي؟») **مش معروض هنا عمدًا**: هو
                  // بيقول نفس معنى العنوان («محتاج مساعدة في إيه؟») بالظبط، وسطرين بنفس
                  // المعنى فوق شريط البحث بيزحموا مساحة الصورة على شاشة موبايل بلا أي فايدة.
                  // الحقل نفسه لسه حي ومعروض في `apps/customer-web` (شاشة أوسع بكتير)، فهو
                  // مش إعداد ميّت في لوحة الأدمن.
                  Text(
                    content.title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      height: 1.25,
                      shadows: [Shadow(color: Colors.black54, blurRadius: 8)],
                    ),
                  ),
                  if (content.description.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    // الجملة دي هي اللي بتعلّم العميل **إزاي** يستخدم البحث («اكتب اسم الحاجة
                    // اللي فيها المشكلة — زي حنفية، غسالة»). طلب مالك صريح، وهي السبب إن
                    // البحث بيرجّع نتايج بدل ما العميل يكتب جملة كاملة ويطلع بلا شيء.
                    Text(
                      content.description,
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.92),
                        fontSize: 12,
                        height: 1.35,
                        shadows: const [
                          Shadow(color: Colors.black54, blurRadius: 6),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  _HeroSearchField(
                    content: content,
                    onSearch: onSearch,
                  ),
                  if (trustMessage.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.verified_outlined,
                          color: Colors.white,
                          size: 16,
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            trustMessage,
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w500,
                              fontSize: 12,
                              shadows: [
                                Shadow(color: Colors.black45, blurRadius: 4),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (effectiveImages.length > 1) ...[
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(
                        effectiveImages.length,
                        (index) => AnimatedContainer(
                          duration: const Duration(milliseconds: 250),
                          width: index == activeIndex ? 20 : 6,
                          height: 6,
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          decoration: BoxDecoration(
                            color: index == activeIndex
                                ? Colors.white
                                : Colors.white54,
                            borderRadius: BorderRadius.circular(99),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// حقل البحث جوّه لوحة الـhero: مضغوط وهو خامل عشان الصورة تفضل ظاهرة، ويتمدد عند التركيز ويقبل
// الكتابة مباشرة قبل فتح شاشة النتائج. النص كله جاي من إعداد homepage.search_content.
class _HeroSearchField extends StatefulWidget {
  final HomepageSearchContent content;
  final ValueChanged<String> onSearch;

  const _HeroSearchField({required this.content, required this.onSearch});

  @override
  State<_HeroSearchField> createState() => _HeroSearchFieldState();
}

class _HeroSearchFieldState extends State<_HeroSearchField> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChanged);
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChanged);
    _focusNode.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _onFocusChanged() => setState(() {});

  void _submit() {
    _focusNode.unfocus();
    widget.onSearch(_controller.text.trim());
  }

  /// **إعادة بناء كاملة (docs/08 §76-ب/ج)** — بلاغ مالك: «محرك البحث شكله مش مضبوط خالص…
  /// حلّ الموضوع ده من جذوره».
  ///
  /// اللي كان غلط في النسخة القديمة، بالترتيب:
  ///  1. **`AnimatedContainer` بارتفاع مقفول (52/58) جوّاه `TextField` كامل**: `InputDecorator`
  ///     بيحسب ارتفاعه الطبيعي من الخط + الحشو + الأيقونات، ولما الرقم المفروض يبقى أقل منه
  ///     المحتوى بيتقصّ. ده مصدر تاني للشرايط الصفرا مستقل عن ارتفاع الـhero.
  ///  2. **`FractionallySizedBox(widthFactor: 0.86 → 0.98)`**: الشريط كان بيتوسّع وقت التركيز،
  ///     يعني بيتحرّك ويغيّر عرضه تحت إصبع المستخدم وهو بيكتب. حركة بلا معنى وظيفي.
  ///  3. **زرار البحث كان بيظهر بس بعد الكتابة**: العميل مش شايف مخرج واضح للبحث من أول نظرة.
  ///
  /// النسخة دي `Row` يدوي: الحشو هو اللي بيحدّد الارتفاع (مفيش رقم مقفول يتقصّ منه)، العرض
  /// ثابت، والزرار ظاهر دايمًا. النتيجة شكل واحد ثابت في كل الحالات — وده اللي بيخلّي العنصر
  /// يبان "مضبوط".
  @override
  Widget build(BuildContext context) {
    final focused = _focusNode.hasFocus;
    return Center(
      child: ConstrainedBox(
        // لجام للشاشات الكبيرة (تابلت/ديسكتوب) — من غيره الشريط بياخد عرض 1100px.
        constraints: const BoxConstraints(maxWidth: 460),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: focused
                  ? AppColors.primary.withValues(alpha: 0.75)
                  : Colors.white.withValues(alpha: 0.85),
              width: focused ? 1.5 : 1,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: focused ? 0.2 : 0.14),
                blurRadius: focused ? 20 : 14,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Row(
            children: [
              const SizedBox(width: 10),
              Icon(
                Icons.search_rounded,
                size: 20,
                color: focused ? AppColors.primary : Colors.blueGrey.shade400,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  key: const ValueKey('homepage-hero-search'),
                  controller: _controller,
                  focusNode: _focusNode,
                  cursorColor: AppColors.primary,
                  style: const TextStyle(
                    color: Color(0xFF172033),
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _submit(),
                  onTapOutside: (_) => _focusNode.unfocus(),
                  // `kSelfPaintedFieldDecoration` (design/app_theme.dart) بيلغي `filled` الموروثة
                  // من الثيم — من غيره الوضع الداكن بيرسم مستطيل غامق جوّه الكبسولة البيضا
                  // (بَقّة مالك حقيقية، docs/08 §78-أ). وبيحطّ `isDense` + حشو صفر كمان:
                  // الارتفاع بيطلع من الخط نفسه، فمفيش فرصة إن `InputDecorator` يتحشر في
                  // مساحة أصغر من اللي محتاجها.
                  decoration: kSelfPaintedFieldDecoration.copyWith(
                    hintText: widget.content.placeholder,
                    hintStyle: TextStyle(
                      color: Colors.blueGrey.shade400,
                      fontSize: 13,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // زرار البحث ظاهر دايمًا — هو اللي بيدّي العنصر ارتفاعه الطبيعي (40 + 12 حشو
              // = 52)، وفي نفس الوقت بيقول للعميل إن ده حقل بحث فعلاً مش مجرد نص.
              SizedBox.square(
                dimension: 40,
                child: Material(
                  color: AppColors.primary,
                  shape: const CircleBorder(),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: _submit,
                    child: const Icon(
                      Icons.arrow_back_rounded,
                      color: Colors.white,
                      size: 20,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
