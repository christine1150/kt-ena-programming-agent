// 관리자 로그인도, PD 공유 링크 접속도 하지 않은 상태로 화면에 접근했을 때 보여주는 안내.
import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900">접근 권한이 없습니다</h1>
      <p className="max-w-md text-zinc-600">
        PD는 관리자가 전달한 공유 링크로만 접속할 수 있고, 관리자는 로그인 후 이용할 수 있습니다.
      </p>
      <Link
        href="/admin/login"
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
      >
        관리자 로그인
      </Link>
    </div>
  );
}
