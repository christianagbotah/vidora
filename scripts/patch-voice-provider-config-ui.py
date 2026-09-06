from pathlib import Path


def patch(path_str: str, replacements: list[tuple[str, str, str]]) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    for old, new, label in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"{path_str} / {label}: expected exactly one match, found {count}")
        text = text.replace(old, new, 1)
        print(f"patched {path_str}: {label}")
    path.write_text(text, encoding="utf-8")


patch("src/app/api/admin/config/route.ts", [
    (
        'import { SECRET_CONFIG_KEYS, setConfigValue } from "@/lib/secure-config";\n',
        'import { SECRET_CONFIG_KEYS, setConfigValue } from "@/lib/secure-config";\nimport { normalizeWebProviderSecret } from "@/lib/provider-secret-policy";\n',
        "provider secret policy import",
    ),
    (
        '''        const fromEnv = Boolean(envName && process.env[envName]?.trim());\n        const legacyDbConfigured = Boolean(rowMap.get(key)?.value);\n        result[key] = {\n          value: fromEnv || legacyDbConfigured ? "********" : "",\n          description,\n          configured: fromEnv || legacyDbConfigured,\n          secret: true,\n          source: fromEnv ? "environment" : legacyDbConfigured ? "legacy-db" : "none",\n        };\n''',
        '''        const fromEnv = Boolean(envName && process.env[envName]?.trim());\n        const dbConfigured = Boolean(rowMap.get(key)?.value);\n        result[key] = {\n          value: fromEnv || dbConfigured ? "********" : "",\n          description,\n          configured: fromEnv || dbConfigured,\n          secret: true,\n          // getConfigValue() resolves encrypted DB values before env fallback.\n          source: dbConfigured ? "encrypted-database" : fromEnv ? "environment" : "none",\n        };\n''',
        "effective secret source",
    ),
    (
        '      secretPolicy: "Provider secrets are write-disabled in the web admin and must be managed through server environment variables.",\n',
        '      secretPolicy: "Optional TTS provider keys may be entered by admins and are encrypted at rest. Other provider/payment secrets remain environment-managed.",\n',
        "secret policy description",
    ),
    (
        '''    const body = await req.json();\n    const updates = body.configs || body;\n    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {\n      return NextResponse.json({ success: false, error: "Invalid configuration payload" }, { status: 400 });\n    }\n\n    const updatedKeys: string[] = [];\n    const blockedSecretKeys: string[] = [];\n\n    for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {\n      if (!(key in CONFIG_SCHEMA)) continue;\n      if (SECRET_CONFIG_KEYS.has(key)) {\n        blockedSecretKeys.push(key);\n        continue;\n      }\n\n      const normalized = validateConfigValue(key, String(value ?? ""));\n      await setConfigValue(key, normalized, CONFIG_SCHEMA[key]);\n      updatedKeys.push(key);\n    }\n\n    if (updatedKeys.includes("zai_base_url")) resetZaiClient();\n\n    return NextResponse.json({\n      success: true,\n      updatedKeys,\n      blockedSecretKeys,\n      ...(blockedSecretKeys.length\n        ? { warning: "Provider secrets were not changed. Update them in the VPS environment and restart the application." }\n        : {}),\n    });\n''',
        '''    const body = await req.json();\n    const updates = body.configs || body;\n    const secretUpdates = body.secretConfigs;\n    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {\n      return NextResponse.json({ success: false, error: "Invalid configuration payload" }, { status: 400 });\n    }\n    if (secretUpdates !== undefined && (typeof secretUpdates !== "object" || secretUpdates === null || Array.isArray(secretUpdates))) {\n      return NextResponse.json({ success: false, error: "Invalid secret configuration payload" }, { status: 400 });\n    }\n\n    const updatedKeys: string[] = [];\n    const updatedSecretKeys: string[] = [];\n    const blockedSecretKeys: string[] = [];\n\n    for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {\n      if (!(key in CONFIG_SCHEMA)) continue;\n      if (SECRET_CONFIG_KEYS.has(key)) {\n        blockedSecretKeys.push(key);\n        continue;\n      }\n\n      const normalized = validateConfigValue(key, String(value ?? ""));\n      await setConfigValue(key, normalized, CONFIG_SCHEMA[key]);\n      updatedKeys.push(key);\n    }\n\n    if (secretUpdates) {\n      for (const [key, rawValue] of Object.entries(secretUpdates as Record<string, unknown>)) {\n        if (!(key in CONFIG_SCHEMA) || !SECRET_CONFIG_KEYS.has(key)) {\n          blockedSecretKeys.push(key);\n          continue;\n        }\n        const normalized = normalizeWebProviderSecret(key, rawValue);\n        // Blank input intentionally means "keep the currently configured key".\n        if (!normalized) continue;\n        await setConfigValue(key, normalized, CONFIG_SCHEMA[key]);\n        updatedSecretKeys.push(key);\n      }\n    }\n\n    if (updatedKeys.includes("zai_base_url")) resetZaiClient();\n\n    return NextResponse.json({\n      success: true,\n      updatedKeys,\n      updatedSecretKeys,\n      blockedSecretKeys,\n      ...(blockedSecretKeys.length\n        ? { warning: "Some protected secrets were not changed. Only optional TTS provider keys can be saved from this page." }\n        : {}),\n    });\n''',
        "write-only encrypted TTS secret updates",
    ),
])


patch("src/app/admin/providers/page.tsx", [
    (
        '''  const [testing, setTesting] = useState(false);\n  const [testingVoice, setTestingVoice] = useState(false);\n  const [message, setMessage] = useState<string>("");\n''',
        '''  const [testing, setTesting] = useState(false);\n  const [testingVoice, setTestingVoice] = useState(false);\n  const [secretForm, setSecretForm] = useState<Record<string, string>>({});\n  const [message, setMessage] = useState<string>("");\n''',
        "secret form state",
    ),
    (
        '''  const setField = (key: string, value: string) => {\n    setForm((current) => ({ ...current, [key]: value }));\n    setMessage("");\n    setError("");\n  };\n\n''',
        '''  const setField = (key: string, value: string) => {\n    setForm((current) => ({ ...current, [key]: value }));\n    setMessage("");\n    setError("");\n  };\n\n  const setSecretField = (key: string, value: string) => {\n    setSecretForm((current) => ({ ...current, [key]: value }));\n    setMessage("");\n    setError("");\n  };\n\n''',
        "secret form setter",
    ),
    (
        '''      const payload: Record<string, string> = {};\n      for (const key of EDITABLE_KEYS) payload[key] = form[key] || "";\n      const response = await fetch("/api/admin/config", {\n        method: "PUT",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ configs: payload }),\n      });\n''',
        '''      const payload: Record<string, string> = {};\n      for (const key of EDITABLE_KEYS) payload[key] = form[key] || "";\n      const secretConfigs: Record<string, string> = {};\n      for (const key of ["zai_tts_api_key", "elevenlabs_api_key"]) {\n        const value = (secretForm[key] || "").trim();\n        if (value) secretConfigs[key] = value;\n      }\n      const response = await fetch("/api/admin/config", {\n        method: "PUT",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ configs: payload, secretConfigs }),\n      });\n''',
        "save TTS secret payload",
    ),
    (
        '''      setMessage("AI provider routing saved. New story and voice jobs will use these settings.");\n      await load();\n''',
        '''      setSecretForm({});\n      setMessage("AI provider routing saved. New story and voice jobs will use these settings.");\n      await load();\n''',
        "clear write-only key fields after save",
    ),
    (
        '<SelectItem value="zai">Z.ai TTS</SelectItem>',
        '<SelectItem value="zai">BigModel GLM-TTS (optional)</SelectItem>',
        "honest BigModel provider label",
    ),
    (
        '''              {ttsProvider === "zai" && (\n                <div className="space-y-2 md:col-span-2">\n                  <Label>GLM-TTS base URL</Label>\n                  <Input\n                    value={form.zai_tts_base_url || ""}\n                    onChange={(event) => setField("zai_tts_base_url", event.target.value)}\n                    placeholder="https://open.bigmodel.cn/api/paas/v4"\n                  />\n                  <p className="text-xs text-muted-foreground">\n                    Voice synthesis uses BigModel/Open Platform independently from the global api.z.ai video/chat endpoint.\n                  </p>\n                </div>\n              )}\n''',
        '''              {ttsProvider === "zai" && (\n                <>\n                  <div className="space-y-2 md:col-span-2">\n                    <Label>BigModel GLM-TTS base URL</Label>\n                    <Input\n                      value={form.zai_tts_base_url || ""}\n                      onChange={(event) => setField("zai_tts_base_url", event.target.value)}\n                      placeholder="https://open.bigmodel.cn/api/paas/v4"\n                    />\n                    <p className="text-xs text-muted-foreground">\n                      Optional speech provider. Your existing global api.z.ai video/chat subscription remains separate and unchanged.\n                    </p>\n                  </div>\n                  <div className="space-y-2 md:col-span-2 rounded-xl border bg-muted/25 p-4">\n                    <div className="flex items-center justify-between gap-3">\n                      <Label>BigModel GLM-TTS API key</Label>\n                      <Badge variant={configs.zai_tts_api_key?.configured ? "default" : "outline"}>\n                        {configs.zai_tts_api_key?.configured ? "Configured" : "Not configured"}\n                      </Badge>\n                    </div>\n                    <Input\n                      type="password"\n                      autoComplete="new-password"\n                      value={secretForm.zai_tts_api_key || ""}\n                      onChange={(event) => setSecretField("zai_tts_api_key", event.target.value)}\n                      placeholder={configs.zai_tts_api_key?.configured ? "Enter a new key only to replace the current one" : "Paste the API key when you are ready"}\n                    />\n                    <p className="text-xs text-muted-foreground">\n                      Write-only field. Vidora encrypts the key server-side and never returns it to this page. Leave blank to keep the current key.\n                    </p>\n                  </div>\n                </>\n              )}\n''',
        "BigModel write-only key field",
    ),
    (
        '''                  <div className="space-y-2">\n                    <Label>ElevenLabs base URL</Label>\n                    <Input value={form.elevenlabs_base_url || ""} onChange={(event) => setField("elevenlabs_base_url", event.target.value)} />\n                  </div>\n                  <div className="space-y-2">\n                    <Label>Default ElevenLabs voice ID</Label>\n''',
        '''                  <div className="space-y-2">\n                    <Label>ElevenLabs base URL</Label>\n                    <Input value={form.elevenlabs_base_url || ""} onChange={(event) => setField("elevenlabs_base_url", event.target.value)} />\n                  </div>\n                  <div className="space-y-2">\n                    <Label>ElevenLabs API key</Label>\n                    <Input\n                      type="password"\n                      autoComplete="new-password"\n                      value={secretForm.elevenlabs_api_key || ""}\n                      onChange={(event) => setSecretField("elevenlabs_api_key", event.target.value)}\n                      placeholder={configs.elevenlabs_api_key?.configured ? "Enter a new key only to replace the current one" : "Paste the API key when you are ready"}\n                    />\n                    <p className="text-xs text-muted-foreground">\n                      {configs.elevenlabs_api_key?.configured ? "Configured · leave blank to keep it" : "Not configured"}\n                    </p>\n                  </div>\n                  <div className="space-y-2">\n                    <Label>Default ElevenLabs voice ID</Label>\n''',
        "ElevenLabs write-only key field",
    ),
    (
        '''              <p className="pt-2 text-xs text-muted-foreground">\n                Add or rotate these values in the VPS environment, then restart Vidora. The web admin only changes routing and non-secret model settings.\n              </p>\n''',
        '''              <p className="pt-2 text-xs text-muted-foreground">\n                BigModel and ElevenLabs TTS keys can be added above when needed. They are stored encrypted and are never displayed again. Other infrastructure/provider secrets remain environment-managed.\n              </p>\n''',
        "server secret guidance",
    ),
])


patch("src/app/page.tsx", [
    (
        '''                      <CardContent className="space-y-5">\n                        {/* Style */}\n''',
        '''                      <CardContent className="space-y-5">\n                        <div className="flex flex-col gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">\n                          <div className="flex items-start gap-2.5">\n                            <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />\n                            <div>\n                              <p className="text-sm font-semibold text-violet-800">Voice provider</p>\n                              <p className="text-xs text-violet-700/80">\n                                Narration providers are optional and separate from the Z.AI video engine. Add or change a speech API key whenever you are ready.\n                              </p>\n                            </div>\n                          </div>\n                          <Button variant="outline" size="sm" asChild className="shrink-0 border-violet-200 bg-white text-violet-700 hover:bg-violet-100">\n                            <a href="/admin/providers">Voice provider settings</a>\n                          </Button>\n                        </div>\n\n                        {/* Style */}\n''',
        "Studio voice provider settings shortcut",
    ),
])

print("voice provider config UI patch complete")
