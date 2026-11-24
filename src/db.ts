import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newDb } from 'pg-mem';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const memoryMode = process.env.DB_MODE === 'memory' || !process.env.DATABASE_URL;

let pool: any;

if (memoryMode) {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  pool = new adapter.Pool();
} else {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

// 建表 + 灌种子。抽成函数以便 PostgreSQL 模式下用 advisory lock 包住，
// 避免 app 与 worker 两个容器并发启动时同时看到空库、重复灌种子导致主键冲突。
async function initSchemaAndSeed(q: (text: string, params?: any[]) => Promise<any[]>) {
  const raw = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const sql = raw.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await q(statement);
  }
  const exists = await q('SELECT COUNT(*)::int AS n FROM person');
  if (exists[0]?.n) return false; // 已有数据，跳过种子
  await seed(q);
  return true;
}

const SERIAL_TABLES = ['person','store','chair','treatment_item','package','package_item','dentist_schedule',
  'appointment','visit_record','prescription','prescription_item','bill','followup_reminder','material',
  'stock_movement','purchase_order','purchase_order_item','treatment_plan','treatment_plan_item',
  'item_cost','expense','doctor_performance','doctor_transfer','approval_record','sms_message','refund_request',
  'coupon_template','coupon','hygiene_schedule','hygiene_appointment','package_order'];

async function init() {
  if (memoryMode) {
    // 内存库单进程，无需加锁
    const q = async (text: string, params: any[] = []) => (await pool.query(text, params)).rows as any[];
    const seeded = await initSchemaAndSeed(q);
    if (seeded) {
      for (const t of SERIAL_TABLES) {
        try { await pool.query(`SELECT setval('${t}_id_seq', (SELECT COALESCE(MAX(id),1) FROM ${t}))`); }
        catch { /* 某些内存库实现不支持 setval，忽略 */ }
      }
    }
    return;
  }

  // PostgreSQL：advisory lock 串行化初始化，保证只有一个容器灌种子
  const client = await pool.connect();
  const LOCK_KEY = 20261123;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const q = async (text: string, params: any[] = []) => (await client.query(text, params)).rows as any[];
    await initSchemaAndSeed(q);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function query(text: string, params: any[] = []) {
  const r = await pool.query(text, params);
  return r.rows as any[];
}

export async function one(text: string, params: any[] = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = async (text: string, params: any[] = []) => (await client.query(text, params)).rows as any[];
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const isMemoryMode = memoryMode;
export default { init, query, one, tx, isMemoryMode };
