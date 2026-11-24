// 统一 API 响应包装
export const wrap = (fn: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
  try {
    const data = await fn(req, res);
    res.json({ ok: true, data });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
};

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => localDate();
export const monthNow = () => localDate().slice(0, 7);
export const num = (v: any) => Number(v || 0);
