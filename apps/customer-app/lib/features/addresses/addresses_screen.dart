import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'address_form_screen.dart';
import 'addresses_repository.dart';
import 'models.dart';

// شاشة اختيار عنوان — بترجع Address المُختار عبر Navigator.pop لما تُستخدم كخطوة جوّه إنشاء طلب،
// أو مجرد إدارة عناوين (list + delete) لما تُفتح من الإعدادات. الفرق بس في selectionMode.
class AddressesScreen extends StatefulWidget {
  final bool selectionMode;

  const AddressesScreen({super.key, this.selectionMode = false});

  @override
  State<AddressesScreen> createState() => _AddressesScreenState();
}

class _AddressesScreenState extends State<AddressesScreen> {
  late final AddressesRepository _repository;
  List<Address>? _addresses;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = AddressesRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final addresses = await _repository.list();
      if (mounted) setState(() => _addresses = addresses);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _addNew() async {
    final created = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => AddressFormScreen(repository: _repository)),
    );
    if (created != null) {
      await _load();
      if (widget.selectionMode && mounted) Navigator.of(context).pop(created);
    }
  }

  Future<void> _edit(Address address) async {
    final updated = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => AddressFormScreen(repository: _repository, existingAddress: address)),
    );
    if (updated != null) await _load();
  }

  Future<void> _remove(Address address) async {
    try {
      await _repository.remove(address.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(widget.selectionMode ? 'اختار عنوان الطلب' : 'عناويني')),
        floatingActionButton: FloatingActionButton(
          onPressed: _addNew,
          child: const Icon(Icons.add),
        ),
        body: _error != null
            ? Center(child: Text(_error!))
            : _addresses == null
                ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                : _addresses!.isEmpty
                    ? const Center(
                        child: EmptyState(
                          icon: Icons.location_on_outlined,
                          title: 'مفيش عناوين محفوظة',
                          description: 'ضيف عنوان عشان تقدر تطلب',
                        ),
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _addresses!.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final address = _addresses![index];
                          return Card(
                            child: ListTile(
                              title: Text(address.displayTitle),
                              subtitle: Row(
                                children: [
                                  Expanded(child: Text(address.streetName)),
                                  // تحذير بسيط (docs/08 §22 بند 12) — العنوان ده مرتبط بطلب شغال
                                  // دلوقتي، ظاهر قبل حتى ما العميل يفتح التعديل.
                                  if (address.hasActiveOrder)
                                    const Padding(
                                      padding: EdgeInsets.only(right: 8),
                                      child: Icon(Icons.warning_amber_rounded, color: Colors.orange, size: 18),
                                    ),
                                ],
                              ),
                              trailing: widget.selectionMode
                                  ? null
                                  : IconButton(
                                      icon: const Icon(Icons.delete_outline),
                                      onPressed: () => _remove(address),
                                    ),
                              onTap: widget.selectionMode
                                  ? () => Navigator.of(context).pop(address)
                                  : () => _edit(address),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}
