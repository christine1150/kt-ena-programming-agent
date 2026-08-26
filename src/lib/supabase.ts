// Supabase 클라이언트를 만들어주는 도우미 파일 — 서버 전용(이 파일은 API Route Handler·
// Server Component·서버 lib에서만 import된다, 절대 "use client" 컴포넌트에서 쓰지 말 것).
//
// 보안 수정(2026-08-26, Supabase Security Advisor 경고 대응: "Table publicly accessible" /
// "Sensitive data publicly accessible"): 지금까지 이 클라이언트가 anon 키를 썼는데, DB의
// public 스키마 테이블 25개 전부 RLS(Row Level Security)가 꺼져 있었다 — 접근 제어를 전부
// Next.js 세션 쿠키(app 레이어)로만 했지 DB 레이어에는 아무 제약이 없었던 것. anon 키는
// 브라우저 번들에 그대로 노출되는 "공개 키"라, RLS 없이 anon 키만으로 REST API를 직접
// 두드리면 Next.js 세션 검사를 완전히 건너뛰고 모든 테이블(관리자 계정 정보가 담긴 admins
// 포함)을 읽고/쓰고/지울 수 있었다(admins 테이블은 로그인 비밀번호 해시가 담겨 있어 특히
// 심각). 고쳐야 할 두 가지를 함께 적용: (1) 이 서버 전용 클라이언트는 service_role 키로
// 바꾼다(service_role은 RLS를 무시하고 항상 전체 접근 — 앱은 지금처럼 그대로 동작),
// (2) 모든 테이블에 RLS를 켜고 anon/authenticated용 정책은 하나도 두지 않는다(마이그레이션
// 20260826160000) — 그러면 공개 anon 키만으로는 이제 아무 테이블도 못 건드리고, 서버(이
// 파일, service_role)만 계속 접근 가능하다. service_role 키는 NEXT_PUBLIC_ 접두사가 없어
// Next.js가 클라이언트 번들에 절대 포함시키지 않는다(실수로 클라이언트 컴포넌트에서 이
// 파일을 import해도 그 값은 undefined가 되어 즉시 실패할 뿐, 키가 새어나가지는 않음).
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
