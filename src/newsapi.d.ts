declare module "newsapi" {
  interface Article {
    source: { id: string | null; name: string };
    author: string | null;
    title: string;
    description: string | null;
    url: string;
    publishedAt: string;
    content: string | null;
  }

  interface Response {
    status: string;
    totalResults: number;
    articles: Article[];
  }

  class NewsAPI {
    constructor(apiKey: string);
    v2: {
      topHeadlines(params: Record<string, any>): Promise<Response>;
      everything(params: Record<string, any>): Promise<Response>;
    };
  }

  export = NewsAPI;
}
