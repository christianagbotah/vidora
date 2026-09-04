from pathlib import Path


def replace_exact(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, found {count}")
    return text.replace(old, new, 1)


path = Path("src/app/share/[slug]/ShareClient.tsx")
text = path.read_text(encoding="utf-8")

text = replace_exact(
    text,
    "  initialProject: ShareProject;",
    "  initialProject: ShareProject | null;",
    "nullable protected initial project",
)

old_load = '''  // Load project after password unlock
  const loadProject = async (pwd?: string) => {
    const url = pwd ? `/api/share/${slug}?password=${encodeURIComponent(pwd)}` : `/api/share/${slug}`;
    const res = await fetch(url, { headers: { "x-viewer-id": viewerIdRef.current } });
    if (res.status === 401) {
      const data = await res.json();
      if (data.requiresPassword) {
        setPasswordError("Incorrect password. Please try again.");
        return false;
      }
    }
    const data = await res.json();
    if (data.success) {
      setProject(data.project);
      setUnlocked(true);
      return true;
    }
    return false;
  };'''
new_load = '''  // Load protected project only after the server verifies the password. The
  // password travels in a header, never in the URL/history/referrer surface.
  const loadProject = async (pwd?: string) => {
    const headers: Record<string, string> = {
      "x-viewer-id": viewerIdRef.current,
    };
    if (pwd) headers["x-share-password"] = pwd;

    const res = await fetch(`/api/share/${encodeURIComponent(slug)}`, {
      headers,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 429) {
      setPasswordError(data.error || "Too many unlock attempts. Please try again later.");
      return false;
    }
    if (res.status === 401 && data.requiresPassword) {
      setPasswordError("Incorrect password. Please try again.");
      return false;
    }
    if (data.success && data.project) {
      setProject(data.project);
      setUnlocked(true);
      setPassword("");
      return true;
    }

    setPasswordError(data.error || "Unable to unlock this video.");
    return false;
  };'''
text = replace_exact(text, old_load, new_load, "password header unlock")

old_submit = '''  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setPasswordError("");
    const ok = await loadProject(password);
    if (!ok && !passwordError) {
      setPasswordError("Incorrect password.");
    }
    setVerifying(false);
  };'''
new_submit = '''  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setPasswordError("");
    await loadProject(password);
    setVerifying(false);
  };'''
text = replace_exact(text, old_submit, new_submit, "password submit state")

text = replace_exact(
    text,
    '''              placeholder="Enter password"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 h-12 text-lg"''',
    '''              placeholder="Enter password"
              maxLength={256}
              autoComplete="current-password"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 h-12 text-lg"''',
    "bounded password input",
)

text = replace_exact(
    text,
    "                poster={coverImage}",
    "                poster={project.scenes[0]?.imageUrl || coverImage}",
    "protected poster after unlock",
)

path.write_text(text, encoding="utf-8")
print("Protected share client hardened.")
