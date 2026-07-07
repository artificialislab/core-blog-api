// Cliente HTTP canonico do core-blog-api. Cookie httpOnly only (sem JWT no
// client). Usado por todos os sites Vite/React que consomem o blog.
//
// Em dev: aponte VITE_BLOG_API_BASE pro backend (ex.: http://localhost:3001).
// Em prod: deixa default `/api` — o Caddy gateway faz strip prefix.

import {
  BlogApiError,
  type AdminUser,
  type ListPostsParams,
  type LoginResponse,
  type Post,
  type PostSeo,
  type PostStatus,
  type UploadResponse,
} from "./types.js";

export interface ClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface ReqInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export class BlogClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "/api";
    this.fetchImpl =
      opts.fetchImpl ??
      (typeof globalThis !== "undefined" && globalThis.fetch
        ? globalThis.fetch.bind(globalThis)
        : (() => {
            throw new Error(
              "[blog-client] fetch nao disponivel — passe opts.fetchImpl",
            );
          })());
  }

  private async req<T>(path: string, init: ReqInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    let body: BodyInit | undefined;
    if (init.body instanceof FormData) {
      body = init.body;
    } else if (init.body !== undefined && init.body !== null) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(init.body);
    }

    const { body: _ignored, ...rest } = init;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...rest,
      headers,
      body,
      credentials: "include",
    });
    if (!res.ok) {
      let message = String(res.status);
      try {
        const data = (await res.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new BlogApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ─── Posts publicos ───────────────────────────────────────────────────

  async listPublishedPosts(): Promise<Post[]> {
    const { posts } = await this.req<{ posts: Post[] }>("/posts");
    return posts;
  }

  async getPostBySlug(slug: string): Promise<Post | undefined> {
    try {
      const { post } = await this.req<{ post: Post }>(
        `/posts/slug/${encodeURIComponent(slug)}`,
      );
      return post;
    } catch (err) {
      if (err instanceof BlogApiError && err.status === 404) return undefined;
      throw err;
    }
  }

  // ─── Posts admin (cookie httpOnly) ────────────────────────────────────

  /**
   * Lista TODOS os posts (qualquer status) via rota admin.
   * `limit`/`offset` sao honrados pelo servidor; `status`/`category`/`tag`
   * sao enviados mas ainda nao implementados no backend.
   */
  async listPosts(params: ListPostsParams = {}): Promise<Post[]> {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    if (params.category) qs.set("category", params.category);
    if (params.tag) qs.set("tag", params.tag);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const { posts } = await this.req<{ posts: Post[] }>(
      `/posts/admin/all${suffix}`,
    );
    return posts;
  }

  async getPost(id: string): Promise<Post> {
    const { post } = await this.req<{ post: Post }>(
      `/posts/admin/${encodeURIComponent(id)}`,
    );
    return post;
  }

  async createPost(input: Partial<Post>): Promise<Post> {
    const { post } = await this.req<{ post: Post }>(`/posts/admin`, {
      method: "POST",
      body: input,
    });
    return post;
  }

  async updatePost(id: string, patch: Partial<Post>): Promise<Post> {
    const { post } = await this.req<{ post: Post }>(
      `/posts/admin/${encodeURIComponent(id)}`,
      { method: "PATCH", body: patch },
    );
    return post;
  }

  async deletePost(id: string): Promise<void> {
    await this.req<void>(`/posts/admin/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // ─── Auth (cookie httpOnly) ───────────────────────────────────────────

  async login(email: string, password: string): Promise<LoginResponse> {
    return this.req<LoginResponse>(`/auth/login`, {
      method: "POST",
      body: { email, password },
    });
  }

  async logout(): Promise<void> {
    await this.req<void>(`/auth/logout`, { method: "POST" });
  }

  async me(): Promise<AdminUser | null> {
    try {
      const { user } = await this.req<{ user: AdminUser }>(`/auth/me`);
      return user;
    } catch (err) {
      if (err instanceof BlogApiError && err.status === 401) return null;
      throw err;
    }
  }

  // ─── Uploads ──────────────────────────────────────────────────────────

  async uploadImage(file: File): Promise<UploadResponse> {
    const fd = new FormData();
    fd.append("file", file);
    return this.req<UploadResponse>(`/uploads/admin`, {
      method: "POST",
      body: fd,
    });
  }

  // ─── Util ─────────────────────────────────────────────────────────────

  /**
   * Garante que uma URL retornada pelo backend e relativa e segura pra
   * usar como src. Defesa em profundidade contra retorno comprometido.
   */
  static isSafeUploadUrl(url: string): boolean {
    return url.startsWith("/uploads/") || url.startsWith("uploads/");
  }
}

// Re-exports tipos pra consumo direto.
export {
  BlogApiError,
  type AdminUser,
  type ListPostsParams,
  type LoginResponse,
  type Post,
  type PostSeo,
  type PostStatus,
  type UploadResponse,
};
