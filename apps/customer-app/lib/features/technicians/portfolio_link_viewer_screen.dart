import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'models.dart';
import 'portfolio_embed_url.dart';

// فيديو الفني بيتشغل مضمّن جوّه التطبيق (WebView) بدل ما نودّي المستخدم لتطبيق/متصفح خارجي —
// نفس فلسفة CardPaymentScreen (WebView مباشر لصفحة مستضافة عند طرف تالت).
class PortfolioLinkViewerScreen extends StatelessWidget {
  final PortfolioLink link;

  const PortfolioLinkViewerScreen({super.key, required this.link});

  @override
  Widget build(BuildContext context) {
    final embedUrl = buildPortfolioEmbedUrl(link.platform, link.url, embedVideoId: link.embedVideoId);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(link.title ?? 'فيديو من شغل الفني')),
        body: embedUrl == null
            ? const Center(child: Text('مش قادرين نعرض الفيديو ده — الرابط مش بصيغة معروفة'))
            : WebViewWidget(
                controller: WebViewController()
                  ..setJavaScriptMode(JavaScriptMode.unrestricted)
                  ..loadRequest(Uri.parse(embedUrl)),
              ),
      ),
    );
  }
}
