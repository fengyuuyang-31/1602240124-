import db from './db.js';
import { processFollowups } from './domain.js';

await db.init();
console.log('[worker] 复诊提醒 worker 已启动');

async function tick() {
  try {
    const n = await processFollowups();
    if (n) console.log(`[worker] 本次处理 ${n} 条到期复诊提醒`);
  } catch (e) {
    console.error('[worker] 处理失败', e);
  }
}

await tick();
setInterval(tick, Number(process.env.WORKER_INTERVAL_MS || 60000));
