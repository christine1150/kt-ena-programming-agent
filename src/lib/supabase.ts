// Supabase 클라이언트를 만들어주는 도우미 파일
// .env에 저장된 값(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)을 읽어서 연결한다.
// 값을 코드에 직접 적지 않고 반드시 .env에서 읽어온다 (CLAUDE.md 규칙).
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
