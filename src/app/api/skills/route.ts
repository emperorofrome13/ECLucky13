import { listSkills, readSkill, skillsRoots } from '@/server/prompt-files';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { checkRequest, forbidden } from '@/server/security/auth';

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const url = new URL(req.url);
  const name = url.searchParams.get('name');
  if (name) {
    const file = url.searchParams.get('file') || 'SKILL.md';
    const r = readSkill(name, file);
    if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 200 });
    return Response.json({ ok: true, skill: r.skill, file: r.file, content: r.content });
  }
  return Response.json({
    ok: true,
    roots: skillsRoots(),
    skills: listSkills().map((s) => ({ name: s.name, description: s.description, dir: s.dir, skillFile: s.skillFile })),
  });
}

