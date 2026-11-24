import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { patientRouter } from './routes/patient.js';
import { dentistRouter } from './routes/dentist.js';
import { financeRouter } from './routes/finance.js';
import { performanceRouter } from './routes/performance.js';
import { dbRouter } from './routes/db.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { transferRouter } from './routes/transfer.js';
import { refundRouter } from './routes/refund.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// 预览面板会缓存 HTML/JS 并可能吃掉跳转地址里的版本号，
// 这里统一关闭静态资源缓存，确保每次跳转都拿到最新页面与脚本。
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  },
}));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'xinyi-dental-chain' }));

// ---- 按端/模块拆分的 API ----
app.use('/api/patient', patientRouter);     // 患者小程序
app.use('/api/dentist', dentistRouter);     // 牙医工作站
app.use('/api/finance', financeRouter);     // 费用模块
app.use('/api/performance', performanceRouter); // 连锁医生绩效
app.use('/api/db', dbRouter);               // 数据库
app.use('/api/admin', adminRouter);         // 管理网站共用
app.use('/api/auth', authRouter);           // 登录 / 注册 / 审批 / 角色切换
app.use('/api/transfer', transferRouter);   // 医生临时借调
app.use('/api/refund', refundRouter);       // 退款与幂等

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

const port = Number(process.env.PORT || 3000);
await db.init();
// 复诊提醒由独立 worker（npm run worker）执行，服务启动不重复跑，职责单一
app.listen(port, '0.0.0.0', () => {
  console.log(`[server] 信义口腔系统已启动 http://localhost:${port}`);
  console.log('[server] 端入口：/ 门户 | /patient.html 患者 | /dentist.html 牙医 | /admin.html 管理 | /db.html 数据库');
});
