import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../../design/status_chip.dart';
import 'models.dart';
import 'skills_repository.dart';
import '../../design/confirm_dialog.dart';

// مهاراتي (§29 — بدّل الإصدار القديم خدمة-بخدمة بالكامل، طلب مالك صريح 2026-08-20) — الفني
// بيصرّح بتخصص/فئة كاملة (سباكة، كهرباء، صيانة...) مش خدمة فردية. أي خدمة جديدة تتضاف تحت الفئة
// دي بعد الاعتماد تبقى متاحة له تلقائيًا، بلا أي تصريح إضافي.
class SkillsScreen extends StatefulWidget {
  const SkillsScreen({super.key});

  @override
  State<SkillsScreen> createState() => _SkillsScreenState();
}

class _SkillsScreenState extends State<SkillsScreen> {
  late final SkillsRepository _repository;
  List<TechnicianCategoryDeclaration>? _categories;
  List<ServiceCategoryOption>? _allCategories;
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
      final categories = await _repository.listMyCategories();
      if (mounted) setState(() => _categories = categories);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _categoryName(String categoryId) {
    final match = _allCategories?.where((c) => c.id == categoryId);
    if (match == null || match.isEmpty) return categoryId;
    return match.first.nameAr;
  }

  Future<void> _openAddSkillFlow() async {
    final declared = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _AddSkillScreen(repository: _repository),
      ),
    );
    if (declared == true) await _load();
  }

  Future<void> _withdraw(TechnicianCategoryDeclaration category) async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'سحب التخصص',
      message: category.verificationStatus == 'approved'
          ? 'هتتوقف عن استقبال طلبات التخصص ده — تقدر تطلبه تاني بعدين.'
          : 'هيتلغى طلبك للتخصص ده.',
      cancelLabel: 'رجوع',
    );
    if (!confirmed) return;

    setState(() => _acting = true);
    try {
      await _repository.withdraw(category.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(err.message)));
      }
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
          label: const Text('أضف تخصص'),
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _categories == null
              ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
              : _categories!.isEmpty
              ? ListView(
                  children: const [
                    SizedBox(height: 60),
                    EmptyState(
                      icon: Icons.category_outlined,
                      title: 'لسه مافيش تخصصات مسجّلة',
                      description:
                          'دوس "أضف تخصص" عشان تطلب تخصص جديد (سباكة، كهرباء...) توافق عليه الإدارة',
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                  itemCount: _categories!.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final category = _categories![index];
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
                                    _categoryName(category.categoryId),
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleMedium,
                                  ),
                                ),
                                StatusChip(
                                  label:
                                      categoryVerificationStatusLabelsAr[category
                                          .verificationStatus] ??
                                      category.verificationStatus,
                                  tone: _toneFor(category.verificationStatus),
                                ),
                              ],
                            ),
                            if (category.verificationStatus == 'rejected' &&
                                category.rejectionReason != null) ...[
                              const SizedBox(height: 8),
                              Text(
                                'سبب الرفض: ${category.rejectionReason}',
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            ],
                            if (category.verificationStatus == 'suspended' &&
                                category.rejectionReason != null) ...[
                              const SizedBox(height: 8),
                              Text(
                                'سبب الإيقاف: ${category.rejectionReason}',
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            ],
                            if (category.verificationStatus != 'suspended') ...[
                              const SizedBox(height: 8),
                              Align(
                                alignment: Alignment.centerLeft,
                                child: TextButton(
                                  onPressed: _acting
                                      ? null
                                      : () => _withdraw(category),
                                  child: Text(
                                    category.verificationStatus == 'approved'
                                        ? 'إيقاف التخصص'
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

// خطوة واحدة بس — اختار الفئة، خلاص (§29 — اتشالت خطوة "اختار خدمة جوه الفئة" القديمة، الفني
// بقى بيصرّح بالفئة الكبيرة كلها مش خدمة فردية جواها).
class _AddSkillScreen extends StatefulWidget {
  const _AddSkillScreen({required this.repository});

  final SkillsRepository repository;

  @override
  State<_AddSkillScreen> createState() => _AddSkillScreenState();
}

class _AddSkillScreenState extends State<_AddSkillScreen> {
  List<ServiceCategoryOption>? _categories;
  String? _error;
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

  Future<void> _declare(ServiceCategoryOption category) async {
    setState(() => _submitting = true);
    try {
      await widget.repository.declare(category.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'طلبك لتخصص "${category.nameAr}" اترسل — هيوصلك إشعار لما الإدارة تراجعه',
            ),
          ),
        );
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(err.message)));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('اختار تخصص')),
        body: _error != null
            ? Center(child: Text(_error!))
            : _categories == null
            ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
            : _categories!.isEmpty
            ? const EmptyState(
                icon: Icons.category_outlined,
                title: 'مفيش فئات متاحة دلوقتي',
              )
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _categories!.length,
                separatorBuilder: (context, index) => const SizedBox(height: 4),
                itemBuilder: (context, index) {
                  final category = _categories![index];
                  return Card(
                    child: ListTile(
                      title: Text(category.nameAr),
                      trailing: _submitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.add_circle_outline),
                      onTap: _submitting ? null : () => _declare(category),
                    ),
                  );
                },
              ),
      ),
    );
  }
}
