const fs = require('fs');

const path = 'src/app/page.tsx';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  text = text.replace(from, to);
}

// 1) Project failure is authoritative over stale scene queued/generating flags.
replaceOnce(
`  // A scene counts as "generating" while it is queued for this batch
  // (task not created yet) OR actively rendering — both block duplicate
  // runs and drive the fast 5s refresh cadence.
  const isAnyGenerating = safeScenes.some((s) => s.status === "generating" || s.status === "queued");
  const completedSceneCount = safeScenes.filter((s) => s.videoUrl).length;
  const failedSceneCount = safeScenes.filter((s) => s.status === "failed").length;`,
`  // Project-level failure is authoritative over stale scene flags. A held
  // GenerationRun may leave scenes as queued/generating while the project is
  // deliberately marked failed for safe reconciliation. In that state the
  // studio must expose Retry/Resume instead of trapping the user behind
  // disabled "Generating" controls.
  const projectGenerationInterrupted = currentProject?.status === "failed" || generationPhase === "failed";
  const isAnyGenerating = !projectGenerationInterrupted && safeScenes.some(
    (s) => s.status === "generating" || s.status === "queued"
  );
  const completedSceneCount = safeScenes.filter((s) => s.videoUrl).length;
  const failedSceneCount = safeScenes.filter((s) => s.status === "failed").length;`,
'project failure override'
);

// 2) Make project-level primary generation control become Retry/Resume.
replaceOnce(
`                <Button
                  onClick={handleGenerateAll}
                  disabled={isAnyGenerating || isGenerating}
                  className="btn-gradient"
                >
                  {isGenerating ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Generating...</>
                  ) : isAnyGenerating ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />In Progress...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-1.5" />Generate All Videos</>
                  )}
                </Button>
                {failedSceneCount > 0 && (
                  <Button onClick={handleGenerateAll} variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50">
                    <RotateCcw className="h-4 w-4 mr-1.5" />Retry Failed ({failedSceneCount})
                  </Button>
                )}`,
`                <Button
                  onClick={projectGenerationInterrupted ? handleRetryFailedScenes : handleGenerateAll}
                  disabled={isGenerating || (!projectGenerationInterrupted && isAnyGenerating)}
                  className="btn-gradient"
                >
                  {isGenerating ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />{projectGenerationInterrupted ? "Resuming..." : "Generating..."}</>
                  ) : projectGenerationInterrupted ? (
                    <><RotateCcw className="h-4 w-4 mr-1.5" />Resume Generation</>
                  ) : isAnyGenerating ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />In Progress...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-1.5" />Generate All Videos</>
                  )}
                </Button>
                {failedSceneCount > 0 && !projectGenerationInterrupted && (
                  <Button onClick={handleGenerateAll} variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50">
                    <RotateCcw className="h-4 w-4 mr-1.5" />Retry Failed ({failedSceneCount})
                  </Button>
                )}`,
'project generation controls'
);

// 3) Thread the interrupted-project state into each scene card so stale scene
// statuses cannot leave card buttons stuck in "Generating".
replaceOnce(
`  isGeneratingNarration, isGeneratingScene,
  onSetMusic, onGenerateSubtitles, onToggleBurnSubtitles, onGenerateDubbing, onDeleteDubbing, musicTracks,`,
`  isGeneratingNarration, isGeneratingScene, projectGenerationInterrupted, onResumeGeneration,
  onSetMusic, onGenerateSubtitles, onToggleBurnSubtitles, onGenerateDubbing, onDeleteDubbing, musicTracks,`,
'scene card parameter list'
);
replaceOnce(
`  isGeneratingNarration: boolean;
  isGeneratingScene: boolean;
  onSetMusic: (sceneId: string, trackUrl: string | null, volume: number) => void;`,
`  isGeneratingNarration: boolean;
  isGeneratingScene: boolean;
  projectGenerationInterrupted: boolean;
  onResumeGeneration: () => void;
  onSetMusic: (sceneId: string, trackUrl: string | null, volume: number) => void;`,
'scene card prop types'
);
replaceOnce(
`  const generating = isGeneratingScene || scene.status === "generating" || scene.status === "queued";`,
`  const generating = !projectGenerationInterrupted && (
    isGeneratingScene || scene.status === "generating" || scene.status === "queued"
  );`,
'scene generating override'
);
replaceOnce(
`                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {!scene.videoUrl && !generating && (`,
`                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {!scene.videoUrl && projectGenerationInterrupted && (
                          <Button
                            size="sm" className="h-7 text-xs px-2.5 btn-gradient"
                            onClick={onResumeGeneration}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />Resume Generation
                          </Button>
                        )}
                        {!scene.videoUrl && !generating && !projectGenerationInterrupted && (`,
'scene resume action'
);
replaceOnce(
`                        {!scene.videoUrl && !generating && scene.status !== "failed" && (`,
`                        {!scene.videoUrl && !generating && !projectGenerationInterrupted && scene.status !== "failed" && (`,
'scene edit action guard'
);
replaceOnce(
`                        {scene.status === "failed" && !generating && (`,
`                        {scene.status === "failed" && !generating && !projectGenerationInterrupted && (`,
'scene retry action guard'
);
replaceOnce(
`                              isGeneratingScene={generatingScenes.has(scene.id)}
                              onRetry={handleRetryScene}`,
`                              isGeneratingScene={generatingScenes.has(scene.id)}
                              projectGenerationInterrupted={projectGenerationInterrupted}
                              onResumeGeneration={handleRetryFailedScenes}
                              onRetry={handleRetryScene}`,
'scene card invocation'
);

// 4) Character card: keep voice selector in the avatar/name row; put media
// action icons in one right-aligned horizontal row below it.
replaceOnce(
`                      {safeCharacters.map((char) => (
                        <div key={char.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:border-violet-200 transition-colors">
                          <div className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-violet-200 to-fuchsia-200 flex items-center justify-center shrink-0">
                            {char.imageUrl ? (
                              <img src={char.imageUrl} alt={char.name} className="h-full w-full object-cover" />
                            ) : (
                              <Users className="h-4 w-4 text-violet-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold truncate">{char.name}</p>
                            {char.role && (
                              <Badge variant="outline" className="text-xs px-1 py-0">{char.role}</Badge>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <Button
                              size="sm" variant="ghost" className="h-6 w-6 p-0"
                              onClick={() => { setCharUploadTargetId(char.id); charFileInputRef.current?.click(); }}
                              title="Upload Image"
                            >
                              <UploadCloud className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-6 w-6 p-0"
                              onClick={() => handleGenerateCharPortrait(char.id)}
                              title="Generate AI Portrait"
                            >
                              <Wand2 className="h-3 w-3" />
                            </Button>
                            <Select value={char.voiceId || charVoiceAssign[char.id] || ""} onValueChange={(v) => handleAssignVoice(char.id, v)}>
                              <SelectTrigger className="h-6 w-16 text-xs px-0.5">
                                <Volume2 className="h-2.5 w-2.5" />
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TTS_VOICES.map((v) => (
                                  <SelectItem key={v.id} value={v.id}>
                                    <span className="text-xs">{v.label}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleDeleteClick("character", char.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}`,
`                      {safeCharacters.map((char) => (
                        <div key={char.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:border-violet-200 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-violet-200 to-fuchsia-200 flex items-center justify-center shrink-0">
                              {char.imageUrl ? (
                                <img src={char.imageUrl} alt={char.name} className="h-full w-full object-cover" />
                              ) : (
                                <Users className="h-4 w-4 text-violet-500" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold truncate">{char.name}</p>
                              {char.role && (
                                <Badge variant="outline" className="text-xs px-1 py-0">{char.role}</Badge>
                              )}
                            </div>
                            <Select value={char.voiceId || charVoiceAssign[char.id] || ""} onValueChange={(v) => handleAssignVoice(char.id, v)}>
                              <SelectTrigger className="h-7 w-24 text-xs px-1.5 shrink-0">
                                <Volume2 className="h-3 w-3 shrink-0" />
                                <SelectValue placeholder="Voice" />
                              </SelectTrigger>
                              <SelectContent>
                                {TTS_VOICES.map((v) => (
                                  <SelectItem key={v.id} value={v.id}>
                                    <span className="text-xs">{v.label}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="mt-2 flex items-center justify-end gap-1 border-t border-slate-100 pt-2">
                            <Button
                              size="sm" variant="ghost" className="h-7 w-7 p-0"
                              onClick={() => { setCharUploadTargetId(char.id); charFileInputRef.current?.click(); }}
                              title="Upload Image"
                              aria-label="Upload character image"
                            >
                              <UploadCloud className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7 w-7 p-0"
                              onClick={() => handleGenerateCharPortrait(char.id)}
                              title="Generate AI Portrait"
                              aria-label="Generate AI character portrait"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleDeleteClick("character", char.id)}
                              title="Delete Character"
                              aria-label="Delete character"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}`,
'character card layout'
);

fs.writeFileSync(path, text);
console.log('Applied project retry and character layout patch');
