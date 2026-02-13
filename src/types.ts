export interface NewsItem {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: Date;
}

export interface DigestMessage {
  title: string;
  summary?: string;
  url: string;
  source: string;
}
