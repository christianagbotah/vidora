from pathlib import Path


def replace_exact(text: str, old: str, new: str, *, expected: int = 1, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} exact match(es), found {count}")
    return text.replace(old, new)


page_path = Path("src/app/page.tsx")
page = page_path.read_text(encoding="utf-8")

page = replace_exact(
    page,
    '  const [adminUsers, setAdminUsers] = useState<unknown[]>([]);',
    '  const [adminUsers, setAdminUsers] = useState<Record<string, unknown>[]>([]);',
    label="admin users state",
)
page = replace_exact(
    page,
    '  const [adminPayments, setAdminPayments] = useState<unknown[]>([]);',
    '  const [adminPayments, setAdminPayments] = useState<Record<string, unknown>[]>([]);',
    label="admin payments state",
)
page = replace_exact(
    page,
    '  const [tokenPackages, setTokenPackages] = useState<unknown[]>([]);',
    '  const [tokenPackages, setTokenPackages] = useState<AdminTokenPackage[]>([]);',
    label="token package state",
)
page = replace_exact(
    page,
    'tokenPackages.map((pkg: Record<string, unknown>) => (',
    'tokenPackages.map((pkg: AdminTokenPackage) => (',
    expected=2,
    label="token package render callbacks",
)
page = replace_exact(
    page,
    '''      const scenesToCreate = parsedScenes.length > 0 ? parsedScenes : [{
        prompt: enhancedText || text,
        title: projectTitle || null,
        dialogue: null,
        characterNames: undefined,
      }];''',
    '''      const scenesToCreate: ParsedSceneResult[] = parsedScenes.length > 0 ? parsedScenes : [{
        prompt: enhancedText || text,
        title: projectTitle || null,
        dialogue: null,
        characterNames: undefined,
        visualNote: null,
      }];''',
    label="scene creation fallback",
)
page = replace_exact(
    page,
    '{(apiCosts.historical as Record<string, unknown>).totalOperations}',
    '{String((apiCosts.historical as Record<string, unknown>).totalOperations ?? 0)}',
    label="historical operation render",
)
page = replace_exact(
    page,
    '{(apiCosts.historical as Record<string, unknown>).totalCostUsd}',
    '{String((apiCosts.historical as Record<string, unknown>).totalCostUsd ?? 0)}',
    label="historical cost render",
)
page = replace_exact(
    page,
    '{(apiCosts.historical as Record<string, unknown>).totalTokensSpent}',
    '{String((apiCosts.historical as Record<string, unknown>).totalTokensSpent ?? 0)}',
    label="historical token render",
)
page = replace_exact(
    page,
    '{(p.user as Record<string, unknown>)?.name || (p.user as Record<string, unknown>)?.email || "-"}',
    '{String((p.user as Record<string, unknown>)?.name || (p.user as Record<string, unknown>)?.email || "-")}',
    label="payment user render",
)
page = replace_exact(
    page,
    '<span className="text-xs font-bold text-violet-600">Scene {scene.sceneNumber ?? i + 1}</span>',
    '<span className="text-xs font-bold text-violet-600">Scene {String(scene.sceneNumber ?? i + 1)}</span>',
    label="preview scene number render",
)

page_path.write_text(page, encoding="utf-8")

export_path = Path("src/app/api/export-video/route.ts")
export = export_path.read_text(encoding="utf-8")
export = replace_exact(
    export,
    '''    let projectId = projectIdParam;
    let job = null;''',
    '''    let projectId = projectIdParam;
    let job: {
      id: string;
      projectId: string;
      userId: string | null;
      activeKey: string | null;
      status: string;
      progress: number;
      step: string;
      params: string | null;
      result: string | null;
      error: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | null = null;''',
    label="export job type",
)
export_path.write_text(export, encoding="utf-8")

print("Applied exact strict-TypeScript repairs successfully.")
