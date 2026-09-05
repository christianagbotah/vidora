const fs = require('fs');
const path = 'src/app/page.tsx';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  text = text.replace(from, to);
}

replaceOnce(
`                  <Badge className={\`absolute bottom-1 right-1 text-[9px] font-semibold px-1.5 z-10 \${statusColor}\`}>
                    {scene.status}
                  </Badge>`,
`                  <Badge className={\`absolute bottom-1 right-1 text-[9px] font-semibold px-1.5 z-10 \${projectGenerationInterrupted && !scene.videoUrl ? "bg-amber-50 text-amber-700 border-amber-200" : statusColor}\`}>
                    {projectGenerationInterrupted && !scene.videoUrl ? "interrupted" : scene.status}
                  </Badge>`,
'interrupted status badge'
);

replaceOnce(
`                        <button
                          onClick={() => onGenerate(scene.id, scene.enhancedPrompt || scene.prompt)}
                          disabled={generating}
                          className="w-full group/preview relative rounded-lg overflow-hidden border border-slate-200 hover:border-violet-300 transition-colors disabled:cursor-default"
                        >
                          <img src={scene.imageUrl} alt="" className="w-full aspect-video object-cover" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/preview:bg-black/40 transition-colors">
                            {generating
                              ? <Loader2 className="h-8 w-8 text-white drop-shadow-lg animate-spin" />
                              : <Play className="h-8 w-8 text-white drop-shadow-lg" />}
                          </div>
                        </button>`,
`                        <button
                          onClick={() => projectGenerationInterrupted
                            ? onResumeGeneration()
                            : onGenerate(scene.id, scene.enhancedPrompt || scene.prompt)}
                          disabled={generating}
                          className="w-full group/preview relative rounded-lg overflow-hidden border border-slate-200 hover:border-violet-300 transition-colors disabled:cursor-default"
                          title={projectGenerationInterrupted ? "Resume interrupted generation" : "Generate this scene"}
                        >
                          <img src={scene.imageUrl} alt="" className="w-full aspect-video object-cover" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/preview:bg-black/40 transition-colors">
                            {generating
                              ? <Loader2 className="h-8 w-8 text-white drop-shadow-lg animate-spin" />
                              : projectGenerationInterrupted
                                ? <RotateCcw className="h-8 w-8 text-white drop-shadow-lg" />
                                : <Play className="h-8 w-8 text-white drop-shadow-lg" />}
                          </div>
                        </button>`,
'thumbnail resume routing'
);

fs.writeFileSync(path, text);
console.log('Applied interrupted scene resume guard');
