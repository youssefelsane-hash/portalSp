import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import 'internal_chat_detail_screen.dart';
import 'internal_chat_repository.dart';
import 'models.dart';

class InternalChatListScreen extends StatefulWidget {
  const InternalChatListScreen({super.key});

  @override
  State<InternalChatListScreen> createState() => _InternalChatListScreenState();
}

class _InternalChatListScreenState extends State<InternalChatListScreen> {
  late final InternalChatRepository _repository;
  List<InternalThread>? _threads;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = InternalChatRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final threads = await _repository.fetchThreads();
      if (mounted) setState(() => _threads = threads);
    } catch (_) {
      if (mounted) setState(() => _error = 'حصل خطأ في تحميل المحادثات');
    }
  }

  Future<void> _openThread(InternalThread thread) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => InternalChatDetailScreen(thread: thread)));
    _load();
  }

  Future<void> _pickContactAndStart() async {
    List<InternalContact> contacts;
    try {
      contacts = await _repository.fetchContacts();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('حصل خطأ في تحميل جهات الاتصال')));
      return;
    }
    if (!mounted) return;
    final selected = await showModalBottomSheet<InternalContact>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: contacts
                .map(
                  (c) => ListTile(
                    title: Text(c.fullName),
                    subtitle: const Text('الإدارة'),
                    onTap: () => Navigator.of(context).pop(c),
                  ),
                )
                .toList(),
          ),
        ),
      ),
    );
    if (selected == null) return;
    final thread = await _repository.startThread(selected.userId);
    if (mounted) _openThread(thread);
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('تواصل مع الإدارة')),
        body: _error != null
            ? Center(child: Text(_error!))
            : _threads == null
                ? const Center(child: CircularProgressIndicator())
                : _threads!.isEmpty
                    ? const Center(child: Text('مفيش محادثات لسه — دوس + عشان تبدأ واحدة'))
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          itemCount: _threads!.length,
                          itemBuilder: (context, index) {
                            final thread = _threads![index];
                            return ListTile(
                              title: Text(thread.peerFullName),
                              subtitle: Text(
                                thread.lastMessageAt != null ? 'آخر رسالة: ${thread.lastMessageAt}' : 'مفيش رسائل لسه',
                              ),
                              onTap: () => _openThread(thread),
                            );
                          },
                        ),
                      ),
        floatingActionButton: FloatingActionButton(
          onPressed: _pickContactAndStart,
          child: const Icon(Icons.add),
        ),
      ),
    );
  }
}
