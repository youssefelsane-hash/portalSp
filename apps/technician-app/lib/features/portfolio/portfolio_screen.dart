import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'portfolio_repository.dart';

// معرض أعمال الفني — لينكات فيديوهات من تيك توك/يوتيوب/انستجرام/فيسبوك، تظهر في بروفايله
// العام اللي العميل بيشوفه (apps/customer-app). تفاصيل كاملة في technicians/README.md.
class PortfolioScreen extends StatefulWidget {
  const PortfolioScreen({super.key});

  @override
  State<PortfolioScreen> createState() => _PortfolioScreenState();
}

class _PortfolioScreenState extends State<PortfolioScreen> {
  late final PortfolioRepository _repository;
  final _urlController = TextEditingController();
  final _titleController = TextEditingController();
  List<PortfolioLink>? _links;
  String? _error;
  bool _adding = false;

  @override
  void initState() {
    super.initState();
    _repository = PortfolioRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final links = await _repository.list();
      if (mounted) setState(() => _links = links);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _add() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _adding = true;
      _error = null;
    });
    try {
      await _repository.add(url, title: _titleController.text.trim());
      _urlController.clear();
      _titleController.clear();
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  Future<void> _remove(PortfolioLink link) async {
    try {
      await _repository.remove(link.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('معرض أعمالي')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('حط لينك فيديو من شغلك على تيك توك/يوتيوب/انستجرام/فيسبوك — هيظهر لأي عميل يشوف بروفايلك.'),
            const SizedBox(height: 12),
            TextField(
              controller: _urlController,
              decoration: const InputDecoration(hintText: 'رابط الفيديو', border: OutlineInputBorder()),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(hintText: 'عنوان (اختياري)', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            if (_error != null) Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
            FilledButton(
              onPressed: _adding ? null : _add,
              child: _adding
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('إضافة'),
            ),
            const SizedBox(height: 24),
            const Divider(),
            if (_links == null) const LoadingList(itemCount: 2),
            if (_links != null && _links!.isEmpty) const EmptyState(icon: Icons.video_library_outlined, title: 'مفيش لينكات لسه'),
            if (_links != null)
              for (final link in _links!)
                ListTile(
                  leading: link.thumbnailUrl != null
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: Image.network(link.thumbnailUrl!, width: 48, height: 48, fit: BoxFit.cover),
                        )
                      : const Icon(Icons.play_circle_outline),
                  title: Text(link.title ?? link.platform),
                  subtitle: Text(link.url, maxLines: 1, overflow: TextOverflow.ellipsis),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () => _remove(link),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}
