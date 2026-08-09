class PortfolioLink {
  final String id;
  final String platform;
  final String url;
  final String? title;
  final String? thumbnailUrl;

  PortfolioLink({required this.id, required this.platform, required this.url, required this.title, required this.thumbnailUrl});

  factory PortfolioLink.fromJson(Map<String, dynamic> json) => PortfolioLink(
        id: json['id'] as String,
        platform: json['platform'] as String,
        url: json['url'] as String,
        title: json['title'] as String?,
        thumbnailUrl: json['thumbnail_url'] as String?,
      );
}
