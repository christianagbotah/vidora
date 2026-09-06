from pathlib import Path

path = Path("src/app/page.tsx")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        '''  const [expandedPrompt, setExpandedPrompt] = useState(false);\n  const [narrationVoice, setNarrationVoice] = useState(scene.narrationVoice || "tongtong");\n  const [narrationLanguage, setNarrationLanguage] = useState(scene.narrationLang || "en");\n  const [narrationAccent, setNarrationAccent] = useState(scene.narrationAccent || "auto");\n  const [narrationStyle, setNarrationStyle] = useState(scene.narrationStyle || "natural");\n''',
        '''  const [expandedPrompt, setExpandedPrompt] = useState(false);\n  const [narrationVoice, setNarrationVoice] = useState(scene.narrationVoice || "tongtong");\n  const [narrationLanguage, setNarrationLanguage] = useState(scene.narrationLang || "en");\n  const [narrationAccent, setNarrationAccent] = useState(scene.narrationAccent || "auto");\n  const [narrationStyle, setNarrationStyle] = useState(scene.narrationStyle || "natural");\n  const [isSavingNarrationProfile, setIsSavingNarrationProfile] = useState(false);\n  const { toast } = useToast();\n\n  const persistNarrationProfile = async (patch: {\n    language?: string;\n    accent?: string;\n    style?: string;\n    voice?: string;\n  }): Promise<boolean> => {\n    setIsSavingNarrationProfile(true);\n    try {\n      const response = await fetch(`/api/scenes/${scene.id}/narration-profile`, {\n        method: "PATCH",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify(patch),\n      });\n      const data = await response.json();\n      if (!response.ok || !data.success) {\n        throw new Error(data.error || "Failed to save narration settings");\n      }\n      return true;\n    } catch (error) {\n      toast({\n        title: "Could not save voice settings",\n        description: error instanceof Error ? error.message : "Please try again.",\n        variant: "destructive",\n      });\n      return false;\n    } finally {\n      setIsSavingNarrationProfile(false);\n    }\n  };\n\n  const handleNarrationLanguageChange = async (value: string) => {\n    const previous = narrationLanguage;\n    setNarrationLanguage(value);\n    if (!(await persistNarrationProfile({ language: value }))) setNarrationLanguage(previous);\n  };\n\n  const handleNarrationAccentChange = async (value: string) => {\n    const previous = narrationAccent;\n    setNarrationAccent(value);\n    if (!(await persistNarrationProfile({ accent: value }))) setNarrationAccent(previous);\n  };\n\n  const handleNarrationStyleChange = async (value: string) => {\n    const previous = narrationStyle;\n    setNarrationStyle(value);\n    if (!(await persistNarrationProfile({ style: value }))) setNarrationStyle(previous);\n  };\n\n  const handleNarrationVoiceChange = async (value: string) => {\n    const previous = narrationVoice;\n    setNarrationVoice(value);\n    if (!(await persistNarrationProfile({ voice: value }))) setNarrationVoice(previous);\n  };\n''',
        "profile persistence handlers",
    ),
    (
        '''                              onLanguageChange={setNarrationLanguage}\n                              onAccentChange={setNarrationAccent}\n                              onStyleChange={setNarrationStyle}\n                              onVoiceChange={setNarrationVoice}\n                              disabled={isGeneratingNarration}\n''',
        '''                              onLanguageChange={(value) => { void handleNarrationLanguageChange(value); }}\n                              onAccentChange={(value) => { void handleNarrationAccentChange(value); }}\n                              onStyleChange={(value) => { void handleNarrationStyleChange(value); }}\n                              onVoiceChange={(value) => { void handleNarrationVoiceChange(value); }}\n                              disabled={isGeneratingNarration || isSavingNarrationProfile}\n''',
        "profile control persistence",
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)
    print(f"patched: {label}")

path.write_text(text, encoding="utf-8")
print("narration profile UI patch complete")
