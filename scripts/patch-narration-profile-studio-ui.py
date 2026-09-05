from pathlib import Path

path = Path("src/app/page.tsx")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)
    print(f"patched: {label}")


replace_once(
    'import ScrollToTop from "@/components/ScrollToTop";\n',
    'import ScrollToTop from "@/components/ScrollToTop";\nimport NarrationProfileControls from "@/components/NarrationProfileControls";\n',
    "NarrationProfileControls import",
)

replace_once(
    '  onNarrate: (id: string, voice?: string) => void;\n',
    '''  onNarrate: (\n    id: string,\n    voice?: string,\n    profile?: { language: string; accent: string; style: string },\n  ) => void;\n''',
    "SortableSceneCard onNarrate type",
)

replace_once(
    '''  const [expandedPrompt, setExpandedPrompt] = useState(false);\n  const [narrationVoice, setNarrationVoice] = useState(scene.narrationVoice || "tongtong");\n''',
    '''  const [expandedPrompt, setExpandedPrompt] = useState(false);\n  const [narrationVoice, setNarrationVoice] = useState(scene.narrationVoice || "tongtong");\n  const [narrationLanguage, setNarrationLanguage] = useState(scene.narrationLang || "en");\n  const [narrationAccent, setNarrationAccent] = useState("auto");\n  const [narrationStyle, setNarrationStyle] = useState("natural");\n''',
    "scene narration profile state",
)

replace_once(
    '''                        {scene.dialogue && !scene.narrationUrl && (\n                          <div className="flex items-center gap-1">\n                            <Select value={narrationVoice} onValueChange={setNarrationVoice}>\n                              <SelectTrigger className="h-7 w-24 text-xs px-1.5">\n                                <SelectValue />\n                              </SelectTrigger>\n                              <SelectContent>\n                                {TTS_VOICES.map((v) => (\n                                  <SelectItem key={v.id} value={v.id}>\n                                    <span className="text-xs">{v.label}</span>\n                                  </SelectItem>\n                                ))}\n                              </SelectContent>\n                            </Select>\n                            <Button\n                              size="sm" variant="outline" className="h-7 text-xs px-2.5"\n                              onClick={() => onNarrate(scene.id, narrationVoice)}\n                              disabled={isGeneratingNarration}\n                            >\n                              {isGeneratingNarration\n                                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />...</>\n                                : <><Volume2 className="h-3.5 w-3.5 mr-1" />Narrate</>\n                              }\n                            </Button>\n                          </div>\n                        )}\n''',
    '''                        {scene.dialogue && !scene.narrationUrl && (\n                          <div className="w-full basis-full rounded-lg border border-violet-100 bg-violet-50/40 p-2.5 space-y-2">\n                            <NarrationProfileControls\n                              compact\n                              language={narrationLanguage}\n                              accent={narrationAccent}\n                              style={narrationStyle}\n                              voice={narrationVoice}\n                              voices={TTS_VOICES}\n                              onLanguageChange={setNarrationLanguage}\n                              onAccentChange={setNarrationAccent}\n                              onStyleChange={setNarrationStyle}\n                              onVoiceChange={setNarrationVoice}\n                              disabled={isGeneratingNarration}\n                            />\n                            <div className="flex items-center justify-between gap-2">\n                              <p className="text-[10px] leading-snug text-muted-foreground">\n                                {narrationLanguage === "en"\n                                  ? "Language, accent and style shape this scene's AI performance."\n                                  : "Uses this scene's saved translation for the selected language. Generate dubbing/translation first if needed."}\n                              </p>\n                              <Button\n                                size="sm"\n                                variant="outline"\n                                className="h-7 text-xs px-2.5 shrink-0"\n                                onClick={() => onNarrate(scene.id, narrationVoice, {\n                                  language: narrationLanguage,\n                                  accent: narrationAccent,\n                                  style: narrationStyle,\n                                })}\n                                disabled={isGeneratingNarration}\n                              >\n                                {isGeneratingNarration\n                                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />...</>\n                                  : <><Volume2 className="h-3.5 w-3.5 mr-1" />Narrate</>\n                                }\n                              </Button>\n                            </div>\n                          </div>\n                        )}\n''',
    "scene narration controls",
)

replace_once(
    '''  const handleNarrateScene = async (sceneId: string, voice?: string) => {\n    if (!currentProject) return;\n    setIsGeneratingNarration(true);\n    try {\n      const res = await fetch("/api/generate-narration", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({\n          projectId: currentProject.id,\n          sceneId,\n          voice: voice || "tongtong",\n        }),\n      });\n''',
    '''  const handleNarrateScene = async (\n    sceneId: string,\n    voice?: string,\n    profile?: { language: string; accent: string; style: string },\n  ) => {\n    if (!currentProject) return;\n    setIsGeneratingNarration(true);\n    try {\n      const scene = currentProject.scenes?.find((item) => item.id === sceneId);\n      const language = profile?.language || scene?.narrationLang || "en";\n      const res = await fetch("/api/generate-narration", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({\n          projectId: currentProject.id,\n          sceneId,\n          voice: voice || "tongtong",\n          language,\n          accent: profile?.accent || "auto",\n          style: profile?.style || "natural",\n          ...(language === "en" && scene?.dialogue ? { text: scene.dialogue } : {}),\n        }),\n      });\n''',
    "handleNarrateScene profile request",
)

replace_once(
    '''      if (data.success) {\n        toast({ title: "Narration generated" });\n        refreshProject();\n''',
    '''      if (data.success) {\n        toast({\n          title: "Narration generated",\n          description: `${data.languageName || data.language || "English"} · ${data.accent || "auto"} · ${data.style || "natural"}`,\n        });\n        refreshProject();\n''',
    "narration success feedback",
)

path.write_text(text, encoding="utf-8")
print("Studio narration profile UI patch complete")
