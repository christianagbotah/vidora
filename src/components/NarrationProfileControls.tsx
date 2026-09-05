"use client";

import { Languages, Mic2, Radio, Wand2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DUBBING_LANGUAGE_GROUPS } from "@/lib/dubbing-languages";
import { NARRATION_ACCENTS, NARRATION_STYLES } from "@/lib/narration-profile";

export interface NarrationProfileControlsProps {
  language: string;
  accent: string;
  style: string;
  voice: string;
  voices: Array<{ id: string; label: string; desc?: string }>;
  onLanguageChange: (value: string) => void;
  onAccentChange: (value: string) => void;
  onStyleChange: (value: string) => void;
  onVoiceChange: (value: string) => void;
  compact?: boolean;
  disabled?: boolean;
}

export function NarrationProfileControls({
  language,
  accent,
  style,
  voice,
  voices,
  onLanguageChange,
  onAccentChange,
  onStyleChange,
  onVoiceChange,
  compact = false,
  disabled = false,
}: NarrationProfileControlsProps) {
  const controlClass = compact ? "h-8 text-xs" : "h-9";
  const gridClass = compact
    ? "grid grid-cols-2 lg:grid-cols-4 gap-2"
    : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3";

  return (
    <div className={gridClass}>
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs text-slate-600">
          <Languages className="h-3.5 w-3.5" />Language
        </Label>
        <Select value={language} onValueChange={onLanguageChange} disabled={disabled}>
          <SelectTrigger className={controlClass} aria-label="Narration language">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            {DUBBING_LANGUAGE_GROUPS.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{lang.flag}</span>
                      <span>{lang.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs text-slate-600">
          <Radio className="h-3.5 w-3.5" />Accent
        </Label>
        <Select value={accent} onValueChange={onAccentChange} disabled={disabled}>
          <SelectTrigger className={controlClass} aria-label="Narration accent">
            <SelectValue placeholder="Accent" />
          </SelectTrigger>
          <SelectContent>
            {NARRATION_ACCENTS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs text-slate-600">
          <Mic2 className="h-3.5 w-3.5" />Voice
        </Label>
        <Select value={voice} onValueChange={onVoiceChange} disabled={disabled}>
          <SelectTrigger className={controlClass} aria-label="Narration voice">
            <SelectValue placeholder="Voice" />
          </SelectTrigger>
          <SelectContent>
            {voices.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  {!compact && item.desc ? (
                    <span className="text-[10px] text-muted-foreground">{item.desc}</span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs text-slate-600">
          <Wand2 className="h-3.5 w-3.5" />Speaking style
        </Label>
        <Select value={style} onValueChange={onStyleChange} disabled={disabled}>
          <SelectTrigger className={controlClass} aria-label="Narration speaking style">
            <SelectValue placeholder="Style" />
          </SelectTrigger>
          <SelectContent>
            {NARRATION_STYLES.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export default NarrationProfileControls;
