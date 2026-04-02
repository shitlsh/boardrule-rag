import { NewGameForm } from "./new-game-form";

export default function NewGamePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">新建游戏</h1>
        <p className="text-sm text-muted-foreground">名称会用于生成 slug；之后可在详情页上传规则书。</p>
      </div>
      <NewGameForm />
    </div>
  );
}
