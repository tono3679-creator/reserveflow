import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { SESSION_COOKIE, SESSION_TOKEN_PATTERN } from "@/lib/auth/cookies";

/** ログインなしで開ける画面・API */
const PUBLIC_PATHS = ["/", "/login", "/demo", "/book", "/api/public", "/api/cron"];

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || (p !== "/" && path.startsWith(`${p}/`)));
}

const useSupabase = process.env.AUTH_PROVIDER === "supabase"
  || (!process.env.AUTH_PROVIDER && !!process.env.NEXT_PUBLIC_SUPABASE_URL);

/**
 * すべてのページの前に動く処理。
 *   1. リクエストごとの nonce で Content Security Policy を付ける
 *   2. Supabase Auth を使う場合は、期限が近いセッションを更新する（@supabase/ssr の推奨どおり）
 *   3. ログインの Cookie が無ければログイン画面へ（API は 401）
 *      Cookie が本物か・権限があるかは、各画面・処理がサーバーで確かめる（src/lib/auth）
 */
export async function proxy(request: NextRequest) {
  const csp = buildCsp(createNonce(), {
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: useSupabase ? process.env.NEXT_PUBLIC_SUPABASE_URL : undefined,
  });
  const path = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  let supabaseSignedIn = false;
  if (useSupabase && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    supabaseSignedIn = !!data?.claims?.sub;
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const signedIn = supabaseSignedIn || !!(token && SESSION_TOKEN_PATTERN.test(token));
  if (!isPublic(path) && !signedIn) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "ログインしてください" }, { status: 401, headers: { "content-security-policy": csp } });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
