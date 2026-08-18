import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../../design/status_chip.dart';
import 'models.dart';
import 'skills_repository.dart';

// مهاراتي (Script 4 §2-7) — كانت فجوة موثّقة صراحة: الفني مالوش أي مسار يطلب خدمة بنفسه، كل
// شيء كان معيّن من الأدمن يدوياً. الشاشة دي بتعرض حالة كل خدمة (تحت المراجعة/معتمدة/مرفوضة/
// موقوفة) وبتسمح بطلب خدمة جديدة من نفس الكتالوج الديناميكي اللي العميل بيشوفه.
class SkillsScreen extends StatefulWidget {
  const SkillsScreen({super.key});

  @override
  State<SkillsScreen> createState() => _SkillsScreenState();
}

class _SkillsScreenState extends State<SkillsScreen> {
  late final SkillsRepository _repository;
  List<TechnicianServiceDeclaration>? _services;
  String? _error;
  bool _acting = false;

  @override
  void initState() {
    super.initState();
    _repository = SkillsRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final services = await _repository.listMyServices();
      if (mounted) setState(() => _services = services);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _openAddSkillFlow() async {
    final declared = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _AddSkillScreen(repository: _repository),
      ),
    );
    if (declared == true) await _load();
  }

  Future<void> _withdraw(TechnicianServiceDeclaration service) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('سحب الخدمة'),
          content: Text(
            service.verificationStatus == 'approved'
                ? 'هتتوقف عن استقبال طلبات الخدمة دي — تقدر تطلبها تاني بعدين.'
                : 'هيتلغى طلبك للخدمة دي.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('رجوع'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('تأكيد'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;

    setState(() => _acting = true);
    try {
      await _repository.withdraw(service.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  StatusTone _toneFor(String status) {
    switch (status) {
      case 'approved':
        return StatusTone.success;
      case 'pending_verification':
        return StatusTone.info;
      case 'rejected':
        return StatusTone.danger;
      case 'suspended':
        return StatusTone.warning;
      default:
        return StatusTone.neutral;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('مهاراتي')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _acting ? null : _openAddSkillFlow,
          icon: const Icon(Icons.add),
          label: const Text('أضف مهارة'),
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _services == null
              ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
              : _services!.isEmpty
              ? ListView(
                  children: const [
                    SizedBox(height: 60),
                    EmptyState(
                      icon: Icons.build_outlined,
                      title: 'لسه مافيش خدمات مسجّلة',
                      description:
                          'دوس "أضف مهارة" عشان تطلب خدمة جديدة من الإدارة توافق عليها',
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                  itemCount: _services!.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final service = _services![index];
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    skillLevelLabelsAr[service.skillLevel] ??
                                        service.skillLevel,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleMedium,
                                  ),
                                ),
                                StatusChip(
                                  label:
                                      serviceVerificationStatusLabelsAr[service
                                          .verificationStatus] ??
                                      service.verificationStatus,
                                  tone: _toneFor(service.verificationStatus),
                                ),
                              ],
                            ),
                            if (service.verificationStatus == 'rejected' &&
                                service.rejectionReason != null) ...[
                              const SizedBox(height: 8),
                              Text(
                                'سبب الرفض: ${service.rejectionReason}',
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            ],
                            if (service.verificationStatus == 'suspended' &&
                                service.rejectionReason != null) ...[
                              const SizedBox(height: 8),
                              Text(
                                'سبب الإيقاف: ${service.rejectionReason}',
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            ],
                            if (service.verificationStatus != 'suspended') ...[
                              const SizedBox(height: 8),
                              Align(
                                alignment: Alignment.centerLeft,
                                child: TextButton(
                                  onPressed: _acting
                                      ? null
                                      : () => _withdraw(service),
                                  child: Text(
                                    service.verificationStatus == 'approved'
                                        ? 'إيقاف الخدمة'
                                        : 'سحب الطلب',
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}

// خطوة 1: فئة → خطوة 2: خدمة داخلها — تدرّج هرمي (نفس منطق الكتالوج الديناميكي)، مش قايمة مسطّحة
// بمئات الخدمات في شاشة واحدة (Script 4 §3 — "hierarchical, searchable UX").
class _AddSkillScreen extends StatefulWidget {
  const _AddSkillScreen({required this.repository});

  final SkillsRepository repository;

  @override
  State<_AddSkillScreen> createState() => _AddSkillScreenState();
}

class _AddSkillScreenState extends State<_AddSkillScreen> {
  List<ServiceCategoryOption>? _categories;
  String? _error;
  ServiceCategoryOption? _selectedCategory;
  List<ServiceOption>? _services;
  bool _loadingServices = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  Future<void> _loadCategories() async {
    try {
      final categories = await widget.repository.listCategories();
      if (mounted) setState(() => _categories = categories);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _selectCategory(ServiceCategoryOption category) async {
    setState(() {
      _selectedCategory = category;
      _services = null;
      _loadingServices = true;
    });
    try {
      final services = await widget.repository.listServicesForCategory(
        category.id,
      );
      if (mounted) setState(() => _services = services);
    } on ApiException catch (err) {
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _loadingServices = false);
    }
  }

  Future<void> _declare(ServiceOption service) async {
    setState(() => _submitting = true);
    try {
      await widget.repository.declare(service.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'طلبك لخدمة "${service.nameAr}" اترسل — هيوصلك إشعار لما الإدارة تراجعه',
            ),
          ),
        );
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (err) {
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            _selectedCategory == null ? 'اختار فئة' : _selectedCategory!.nameAr,
          ),
          leading: _selectedCategory != null
              ? IconButton(
                  icon: const Icon(Icons.arrow_forward), // RTL: رجوع بيبان يمين
                  onPressed: () => setState(() {
                    _selectedCategory = null;
                    _services = null;
                  }),
                )
              : null,
        ),
        body: _error != null
            ? Center(child: Text(_error!))
            : _selectedCategory == null
            ? _buildCategoryList()
            : _buildServiceList(),
      ),
    );
  }

  Widget _buildCategoryList() {
    if (_categories == null)
      return const Padding(padding: EdgeInsets.all(16), child: LoadingList());
    if (_categories!.isEmpty) {
      return const EmptyState(
        icon: Icons.category_outlined,
        title: 'مفيش فئات متاحة دلوقتي',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _categories!.length,
      separatorBuilder: (context, index) => const SizedBox(height: 4),
      itemBuilder: (context, index) {
        final category = _categories![index];
        return Card(
          child: ListTile(
            title: Text(category.nameAr),
            trailing: const Icon(Icons.chevron_left),
            onTap: () => _selectCategory(category),
          ),
        );
      },
    );
  }

  Widget _buildServiceList() {
    if (_loadingServices)
      return const Padding(padding: EdgeInsets.all(16), child: LoadingList());
    if (_services == null || _services!.isEmpty) {
      return const EmptyState(
        icon: Icons.build_outlined,
        title: 'مفيش خدمات في الفئة دي دلوقتي',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _services!.length,
      separatorBuilder: (context, index) => const SizedBox(height: 4),
      itemBuilder: (context, index) {
        final service = _services![index];
        return Card(
          child: ListTile(
            title: Text(service.nameAr),
            trailing: _submitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.add_circle_outline),
            onTap: _submitting ? null : () => _declare(service),
          ),
        );
      },
    );
  }
}
