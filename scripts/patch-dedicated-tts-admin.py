from pathlib import Path

path = Path("src/app/admin/providers/page.tsx")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        '  "ai_tts_model",\n  "xai_base_url",',
        '  "ai_tts_model",\n  "zai_tts_base_url",\n  "xai_base_url",',
        "editable TTS base URL",
    ),
    (
        '  const [testing, setTesting] = useState(false);\n  const [message, setMessage] = useState<string>("");',
        '  const [testing, setTesting] = useState(false);\n  const [testingVoice, setTestingVoice] = useState(false);\n  const [message, setMessage] = useState<string>("");',
        "voice-test state",
    ),
    (
        '''  const textProvider = form.ai_text_provider || "zai";\n''',
        '''  const testActiveVoice = async () => {\n    setTestingVoice(true);\n    setMessage("");\n    setError("");\n    try {\n      const response = await fetch("/api/admin/config/test-connection", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ provider: "tts" }),\n      });\n      const data = await response.json();\n      if (!response.ok || !data.success) throw new Error(data.error || "Voice provider test failed");\n      setMessage(`Voice connected: ${data.provider} / ${data.model} / ${data.voice} in ${data.latencyMs} ms (${data.audioBytes} bytes).`);\n    } catch (cause) {\n      setError(cause instanceof Error ? cause.message : "Voice provider test failed");\n    } finally {\n      setTestingVoice(false);\n    }\n  };\n\n  const textProvider = form.ai_text_provider || "zai";\n''',
        "voice-test handler",
    ),
    (
        '''            <Button variant="outline" onClick={testActiveText} disabled={testing || saving}>\n              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}\n              Test text model\n            </Button>\n            <Button onClick={save} disabled={saving || testing}>''',
        '''            <Button variant="outline" onClick={testActiveText} disabled={testing || testingVoice || saving}>\n              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}\n              Test text model\n            </Button>\n            <Button variant="outline" onClick={testActiveVoice} disabled={testing || testingVoice || saving}>\n              {testingVoice ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic2 className="mr-2 h-4 w-4" />}\n              Test voice model\n            </Button>\n            <Button onClick={save} disabled={saving || testing || testingVoice}>''',
        "voice-test header button",
    ),
    (
        '''              <div className="space-y-2">\n                <Label>TTS model</Label>\n                <Input value={form.ai_tts_model || ""} onChange={(event) => setField("ai_tts_model", event.target.value)} placeholder={ttsProvider === "elevenlabs" ? "eleven_v3" : "Leave blank for Z.ai default"} />\n              </div>\n              {ttsProvider === "elevenlabs" && (''',
        '''              <div className="space-y-2">\n                <Label>TTS model</Label>\n                <Input value={form.ai_tts_model || ""} onChange={(event) => setField("ai_tts_model", event.target.value)} placeholder={ttsProvider === "elevenlabs" ? "eleven_v3" : "glm-tts"} />\n              </div>\n              {ttsProvider === "zai" && (\n                <div className="space-y-2 md:col-span-2">\n                  <Label>GLM-TTS base URL</Label>\n                  <Input\n                    value={form.zai_tts_base_url || ""}\n                    onChange={(event) => setField("zai_tts_base_url", event.target.value)}\n                    placeholder="https://open.bigmodel.cn/api/paas/v4"\n                  />\n                  <p className="text-xs text-muted-foreground">\n                    Voice synthesis uses BigModel/Open Platform independently from the global api.z.ai video/chat endpoint.\n                  </p>\n                </div>\n              )}\n              {ttsProvider === "elevenlabs" && (''',
        "dedicated TTS endpoint field",
    ),
    (
        '''              <SecretBadge configs={configs} configKey="zai_api_key" env="ZAI_API_KEY" />\n              <SecretBadge configs={configs} configKey="xai_api_key" env="XAI_API_KEY" />''',
        '''              <SecretBadge configs={configs} configKey="zai_api_key" env="ZAI_API_KEY" />\n              <SecretBadge configs={configs} configKey="zai_tts_api_key" env="ZAI_TTS_API_KEY" />\n              <SecretBadge configs={configs} configKey="xai_api_key" env="XAI_API_KEY" />''',
        "dedicated TTS secret badge",
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)
    print(f"patched: {label}")

path.write_text(text, encoding="utf-8")
