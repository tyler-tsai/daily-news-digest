export interface NewsItem {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: Date;
  // Set by clusterBySignal — number of distinct sources covering this story
  signalCount?: number;
  // Set by clusterBySignal — list of distinct source names in the cluster
  sources?: string[];
  // Set by clusterBySignal — signalCount * average source-tier multiplier
  signalScore?: number;
}

export interface DigestMessage {
  title: string;
  summary?: string;
  url: string;
  source: string;
}
