import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import 'internal_chat_repository.dart';
import 'models.dart';

const _pollInterval = Duration(seconds: 4);

class InternalChatDetailScreen extends StatefulWidget {
  final InternalThread thread;

  const InternalChatDetailScreen({super.key, required this.thread});

  @override
  State<InternalChatDetailScreen> createState() => _InternalChatDetailScreenState();
}

class _InternalChatDetailScreenState extends State<InternalChatDetailScreen> {
  late final InternalChatRepository _repository;
  final _textController = TextEditingController();
  final _scrollController = ScrollController();
  Timer? _pollTimer;
  String? _myUserId;
  List<InternalMessage> _messages = [];
  bool _loading = true;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = InternalChatRepository(auth);
    _myUserId = auth.user?.id;
    _load();
    _pollTimer = Timer.periodic(_pollInterval, (_) => _load());
  }

  Future<void> _load() async {
    final messages = await _repository.fetchMessages(widget.thread.id);
    if (!mounted) return;
    setState(() {
      _messages = messages;
      _loading = false;
    });
  }

  Future<void> _send() async {
    final content = _textController.text.trim();
    if (content.isEmpty) return;
    setState(() => _sending = true);
    try {
      await _repository.sendMessage(widget.thread.id, content);
      _textController.clear();
      await _load();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(widget.thread.peerFullName)),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : Column(
                children: [
                  Expanded(
                    child: ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(16),
                      itemCount: _messages.length,
                      itemBuilder: (context, index) {
                        final message = _messages[index];
                        final isMine = message.senderUserId == _myUserId;
                        return Align(
                          alignment: isMine ? Alignment.centerLeft : Alignment.centerRight,
                          child: Container(
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(
                              color: isMine
                                  ? Theme.of(context).colorScheme.primaryContainer
                                  : Theme.of(context).colorScheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(message.content),
                          ),
                        );
                      },
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _textController,
                            decoration: const InputDecoration(hintText: 'اكتب رسالة...'),
                            onSubmitted: (_) => _send(),
                          ),
                        ),
                        IconButton(
                          icon: _sending
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.send),
                          onPressed: _sending ? null : _send,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
