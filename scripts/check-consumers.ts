import { db } from '../src/lib/db';

async function main() {
  const scenes = await db.videoScene.findMany({
    where: { status: { in: ['pending', 'processing', 'queued'] } },
    select: { id: true, status: true, taskId: true, updatedAt: true },
    take: 20,
  });
  console.log('PENDING/PROCESSING SCENES:', JSON.stringify(scenes, null, 2));

  const jobs = await db.exportJob.findMany({
    where: { status: { in: ['pending', 'processing', 'queued'] } },
    select: { id: true, status: true, updatedAt: true },
    take: 10,
  });
  console.log('PENDING EXPORT JOBS:', JSON.stringify(jobs, null, 2));

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const txs = await db.tokenTransaction.findMany({
    where: { createdAt: { gte: twoDaysAgo } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, operationType: true, amount: true, costUsd: true, description: true, createdAt: true },
    take: 50,
  });
  console.log('RECENT TOKEN TRANSACTIONS (last 48h):', JSON.stringify(txs, null, 2));

  const activeProjects = await db.videoProject.findMany({
    where: { status: { in: ['processing', 'generating'] } },
    select: { id: true, title: true, status: true, updatedAt: true },
    take: 10,
  });
  console.log('ACTIVE PROJECTS:', JSON.stringify(activeProjects, null, 2));

  const recentScenes = await db.videoScene.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true, taskId: true, updatedAt: true },
    take: 10,
  });
  console.log('MOST RECENT SCENES (any status):', JSON.stringify(recentScenes, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
