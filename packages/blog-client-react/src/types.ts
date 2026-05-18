// Tipos canonicos do core-blog-api espelhando o schema PG.
// Use estes nos sites de cliente em vez de redeclarar.

export type PostStatus = "draft" | "scheduled" | "published" | "archived";

export interface PostSeo {
  title?: string | null;
  description?: string | null;
  ogImage?: string | null;
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  cover?: string | null;
  content?: string | null;
  category?: string | null;
  tags?: string[] | null;
  status: PostStatus;
  publishedAt?: string | null;
  scheduledFor?: string | null;
  createdAt?: string;
  updatedAt?: string;
  seo?: PostSeo | null;
}

export interface AdminUser {
  email: string;
  name?: string | null;
  role?: string;
}

export interface LoginResponse {
  user: AdminUser;
}

export interface UploadResponse {
  url: string;
  filename: string;
  size: number;
}

export interface ListPostsParams {
  status?: PostStatus;
  limit?: number;
  offset?: number;
  category?: string;
  tag?: string;
}

export class BlogApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "BlogApiError";
  }
}
