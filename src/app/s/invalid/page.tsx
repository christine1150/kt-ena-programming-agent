// 유효하지 않거나 재발급으로 무효화된 공유 링크로 들어왔을 때 보여주는 안내 화면.
export default function InvalidShareLinkPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50 px-6 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900">링크가 만료되었거나 올바르지 않습니다</h1>
      <p className="max-w-md text-zinc-600">
        관리자가 링크를 재발급했거나, 주소가 잘못 입력되었을 수 있습니다.
        <br />
        담당 관리자에게 최신 공유 링크를 다시 요청해주세요.
      </p>
    </div>
  );
}
