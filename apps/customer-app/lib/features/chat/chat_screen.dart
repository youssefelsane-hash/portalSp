import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'chat_client.dart';
import 'chat_repository.dart';
import 'models.dart';

class ChatScreen extends StatefulWidget {
  final String orderId;

  const ChatScreen({super.key, required this.orderId});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  late final ChatRepository _repository;
  final _client = ChatClient();
  final _textController = TextEditingController();
  final _scrollController = ScrollController();
  String? _myUserId;
  String? _threadId;
  List<ChatMessage> _messages = [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = ChatRepository(auth);
    _myUserId = auth.user?.id;
    _load(auth.accessToken!);
  }

  Future<void> _load(String accessToken) async {
    try {
      final threadId = await _repository.getThreadIdForOrder(widget.orderId);
      final history = await _repository.listMessages(threadId);
      if (!mounted) return;
      setState(() {
        _threadId = threadId;
        _messages = history;
        _loading = false;
      });
      _client.connect(
        accessToken: accessToken,
        threadId: threadId,
        onMessageReceived: (message) {
          if (mounted) setState(() => _messages = [..._messages, message]);
        },
        onError: (message) {
          if (mounted) setState(() => _error = message);
        },
      );
    } on ApiException catch (err) {
      if (mounted) {
        setState(() {
          _error = err.message;
          _loading = false;
        });
      }
    }
  }

  void _send() {
    final content = _textController.text.trim();
    if (content.isEmpty || _threadId == null) return;
    _client.sendMessage(_threadId!, content);
    _textController.clear();
  }

  @override
  void dispose() {
    _client.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('الشات مع الفني')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _threadId == null
                ? Center(child: Text(_error!))
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
                                child: Text(message.content ?? ''),
                              ),
                            );
                          },
                        ),
                      ),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Text(_error!, style: const TextStyle(color: Colors.red)),
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
                            IconButton(icon: const Icon(Icons.send), onPressed: _send),
                          ],
                        ),
                      ),
                    ],
                  ),
      ),
    );
  }
}
