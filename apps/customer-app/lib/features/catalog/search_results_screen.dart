import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../design/app_theme.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'catalog_navigation.dart';
import 'catalog_repository.dart';
import 'service_card.dart';
import 'models.dart';

/// المهلة بين آخر حرف والطلب اللي بيروح للسيرفر.
///
/// طلب المالك صراحةً (2026-09-11): «نخلي فيه ثانية واحدة بين كل حرف والتاني عشان الموقع
/// ما يسحبش requests كتير». كانت 400ms.
///
/// المهلة دي **مابتأخّرش اللي المستخدم بيشوفه**: الفلترة المحلية بتحصل على كل حرف فورًا
/// (صفر طلبات، صفر تأخير)، والطلب اللي بعد الثانية بيجيب المطابقات اللي الفلترة المحلية
/// مابتشوفهاش (الكلمات المفتاحية والمرادفات في `search_keywords`).
const Duration kSearchDebounce = Duration(seconds: 1);

/// شاشة البحث — **بتعرض كل الخدمات من أول ما تفتح**، وبتفلتر مع الكتابة.
///
/// بلاغ المالك (2026-09-11): «السيرش المفروض يبقى بيعرض كل حاجة افتراضيًا ويفلتر مع الكتابة…
/// ما يبقاش فيه تهنيج ولا لاج ولا تقطيع».
///
/// **ليه طبقتين (محلية + سيرفر) مش واحدة؟**
///  - **محلية فورية**: القايمة الكاملة محمّلة أصلاً، فالفلترة بالاسم/الوصف بتحصل في نفس
///    الإطار. ده اللي بيشيل اللاج تمامًا — مفيش انتظار شبكة عشان تشوف نتيجة.
///  - **سيرفر بعد ثانية**: الباك-إند بيطابق كمان على `search_keywords` والمرادفات وبيشيل
///    "ال" التعريف (`catalog.service.ts searchServices`) — حاجات الفلترة المحلية عمياها.
///    لما نتيجته توصل بتحلّ محل المحلية لأنها أغنى.
///
/// كان قبل كده: شاشة فاضية مكتوب فيها «اكتب وصف مشكلتك» لحد ما المستخدم يكتب حرفين.
class SearchResultsScreen extends StatefulWidget {
  final String initialQuery;
  final String? zoneId;

  const SearchResultsScreen({super.key, this.initialQuery = '', this.zoneId});

  @override
  State<SearchResultsScreen> createState() => _SearchResultsScreenState();
}

class _SearchResultsScreenState extends State<SearchResultsScreen> {
  final _repository = CatalogRepository();
  final _controller = TextEditingController();
  Timer? _debounce;

  /// القايمة الكاملة — بتتحمّل مرة واحدة وبتفضل أساس الفلترة المحلية.
  List<CatalogService>? _allServices;

  /// نتيجة السيرفر لآخر استعلام (أغنى من المحلية). `null` = لسه مجاش رد أو الاستعلام فاضي.
  List<CatalogService>? _serverResults;

  String _query = '';
  String? _error;
  bool _searching = false;

  /// بيمنع رد بطيء لاستعلام قديم إنه يحلّ محل رد أحدث (سباق حقيقي مع debounce ثانية كاملة).
  int _requestSeq = 0;

  @override
  void initState() {
    super.initState();
    _controller.text = widget.initialQuery;
    _query = widget.initialQuery.trim();
    _loadAll();
    if (_query.length >= 2) _search(_query);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    try {
      final services = await _repository.fetchServices(zoneId: widget.zoneId);
      if (mounted) setState(() => _allServices = services);
    } catch (errRaw) {
      // فشل تحميل القايمة الكاملة مش لازم يقفل البحث: الكتابة لسه بتشتغل عن طريق السيرفر.
      final err = ApiException.from(errRaw);
      if (mounted) {
        setState(() {
          _allServices = const [];
          _error = err.message;
        });
      }
    }
  }

  void _onChanged(String value) {
    // التحديث المحلي بيحصل فورًا — مش مستني الـdebounce. ده مقصود: اللي المستخدم بيشوفه
    // بيتحرّك مع كل حرف، واللي بيتأجّل هو الطلب اللي بيروح للشبكة بس.
    setState(() {
      _query = value.trim();
      _serverResults = null;
      _error = null;
    });
    _debounce?.cancel();
    if (_query.length < 2) {
      setState(() => _searching = false);
      return;
    }
    setState(() => _searching = true);
    _debounce = Timer(kSearchDebounce, () => _search(value));
  }

  Future<void> _search(String value) async {
    final trimmed = value.trim();
    if (trimmed.length < 2) {
      if (mounted) setState(() => _searching = false);
      return;
    }
    final seq = ++_requestSeq;
    try {
      final results = await _repository.searchServices(
        trimmed,
        zoneId: widget.zoneId,
      );
      if (!mounted || seq != _requestSeq) return;
      setState(() {
        _serverResults = results;
        _error = null;
        _searching = false;
      });
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      if (!mounted || seq != _requestSeq) return;
      setState(() {
        _error = err.message;
        _searching = false;
      });
    }
  }

  /// الفلترة المحلية — نفس الحقول اللي الباك-إند بيطابق عليها، ناقص الكلمات المفتاحية
  /// (مش موجودة في عقد `CatalogService` أصلاً) — وده بالظبط اللي طلب السيرفر بيكمّله.
  List<CatalogService> get _visible {
    final all = _allServices ?? const <CatalogService>[];
    if (_serverResults != null) return _serverResults!;
    if (_query.isEmpty) return all;
    final needle = _query.toLowerCase();
    return all
        .where(
          (s) =>
              s.nameAr.toLowerCase().contains(needle) ||
              (s.shortDescriptionAr ?? '').toLowerCase().contains(needle),
        )
        .toList();
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: TextField(
            controller: _controller,
            // **مش `autofocus`**: الشاشة دلوقتي بتعرض كل الخدمات أول ما تفتح، وفتح الكيبورد
            // تلقائيًا كان بيغطّي نص المحتوى اللي المستخدم جاي يشوفه. وكمان الكيبورد هو اللي
            // كان بيصغّر الارتفاع المتاح لحد ما الحالة الفاضية تعمل overflow.
            autofocus: false,
            textInputAction: TextInputAction.search,
            // نفس بَقّة الوضع الداكن اللي اتصلحت في الـhero (docs/08 §78-أ) بالظبط: الحقل ده
            // بيرسم جوّه سطح الـAppBar، و`InputBorder.none` بتشيل الإطار بس — التعبئة الموروثة
            // من الثيم كانت بترسم مستطيل غامق جوّه شريط الرأس. اتلقطت هنا بالمسح مش ببلاغ.
            decoration: kSelfPaintedFieldDecoration.copyWith(
              hintText: 'دوّر على خدمة...',
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close_rounded, size: 18),
                      tooltip: 'مسح البحث',
                      onPressed: () {
                        _controller.clear();
                        _onChanged('');
                      },
                    ),
            ),
            onChanged: _onChanged,
            onSubmitted: (value) {
              // الإرسال بيتخطّى الـdebounce: المستخدم قال خلاص.
              _debounce?.cancel();
              _search(value);
            },
          ),
          bottom: _searching
              ? const PreferredSize(
                  preferredSize: Size.fromHeight(2),
                  child: LinearProgressIndicator(minHeight: 2),
                )
              : null,
        ),
        body: _allServices == null
            ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
            : _error != null && visible.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(_error!, textAlign: TextAlign.center),
                ),
              )
            : visible.isEmpty
            // `SingleChildScrollView` مقصود: الكيبورد بياخد ~300px من الارتفاع المتاح،
            // و`EmptyState` عمود بارتفاع ثابت. من غير التمرير ده الحالة الفاضية بتعمل
            // `RenderFlex overflowed` مع تكبير خط النظام — اتقاست فعليًا قبل الإصلاح.
            ? SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  child: EmptyState(
                    icon: Icons.search_off,
                    title: _query.isEmpty
                        ? 'مفيش خدمات متاحة في منطقتك دلوقتي'
                        : 'مفيش خدمات مطابقة لـ"$_query" — جرّب كلمة تانية',
                  ),
                ),
              )
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: visible.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final service = visible[index];
                  // نفس كارت قايمة الفئة بالحرف (docs/08 §72) — شكل واحد للخدمة في كل
                  // مكان بيتعرض فيه، مش شكلين مختلفين حسب الشاشة.
                  return ServiceCard(
                    service: service,
                    priceLabel: service.pricingModel == 'formula'
                        ? 'يُحسب حسب التفاصيل'
                        : _formatEgp(service.basePriceCents),
                    onTap: () => navigateToServiceBooking(context, service),
                  );
                },
              ),
      ),
    );
  }
}
