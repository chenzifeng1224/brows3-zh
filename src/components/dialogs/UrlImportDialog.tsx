'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, IconButton, Pagination, TextField, Typography } from '@mui/material';
import { Close, ExpandLess, ExpandMore } from '@mui/icons-material';
import { BaseDialog } from '@/components/common/BaseDialog';
import { urlActionStyles } from '@/components/common/urlActionStyles';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DEFAULT_URL_LIMIT, MAX_MANIFEST_BYTES, MAX_URL_IMPORTS, parseUrlImports, UrlImportEntry, validateImport } from '@/lib/urlImport';
import { urlApi } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';
import { useProfileStore } from '@/store/profileStore';
import { toast } from '@/store/toastStore';

interface Props { bucket: string; region?: string; prefix: string; profileId: string; onClose: () => void; initialPath?: string; initialLimits?: { max_bytes: number; max_attempts?: number; sha256: string | null } }
interface Row { id: number; entry: UrlImportEntry; headerText: string; expanded: boolean }
const pill = urlActionStyles;
export default function UrlImportDialog({ bucket, region, prefix, profileId, onClose, initialPath, initialLimits }: Props) {
  const activeProfile = useProfileStore(s => s.activeProfileId);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [discard, setDiscard] = useState(false);
  const pending = useRef(false), alive = useRef(true), nextId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const update = (id: number, patch: Partial<UrlImportEntry>) => setRows(current => current.map(r => r.id === id ? { ...r, entry: { ...r.entry, ...patch } } : r));
  const materialize = (row: Row): UrlImportEntry => ({ ...row.entry, headers: JSON.parse(row.headerText || '{}') });
  const errors = rows.map(row => {
    try { const entry = materialize(row); return validateImport(entry) || (new TextEncoder().encode(prefix + entry.path).length > 1024 ? '完整目标键超过 1,024 字节。' : rows.some(other => other.id !== row.id && other.entry.path === entry.path) ? '目标路径重复。请重命名或移除此条目。' : ''); }
    catch { return '请求头必须是有效的 JSON 对象。'; }
  });
  const add = (source: string, format: 'text' | 'csv' | 'json') => {
    const parsed = parseUrlImports(source, format);
    if (rows.length + parsed.length > MAX_URL_IMPORTS) throw new Error(`每批最多 ${MAX_URL_IMPORTS} 个文件。`);
    if (initialPath && (parsed.length !== 1 || rows.length)) throw new Error('请为此文件添加一个用于替换的源 URL。');
    setRows(current => [...current, ...parsed.map(entry => ({ id: nextId.current++, entry: { ...entry, ...(initialLimits ? { max_bytes: initialLimits.max_bytes, sha256: initialLimits.sha256, max_attempts: initialLimits.max_attempts || 3 } : {}), path: initialPath ?? entry.path }, headerText: JSON.stringify(entry.headers, null, 2), expanded: false }))]);
    setText(''); setError('');
  };
  const close = () => { if (pending.current || reading) return; if (rows.length || text.trim()) setDiscard(true); else onClose(); };
  async function submit() {
    if (pending.current || reading || !rows.length || errors.some(Boolean) || activeProfile !== profileId) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const count = await urlApi.importUrls(bucket, region, prefix, rows.map(materialize), profileId);
      void useTransferStore.getState().refreshJobs(); useTransferStore.getState().showPanel();
      toast.success(`${count} 个 URL 导入已排队`, '可在「上传」中查看进度。');
      if (alive.current) onClose();
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <><BaseDialog open title={initialPath ? '替换导入源' : '从 URL 导入'} maxWidth="md" onClose={close} closeDisabled={busy || reading} actions={<>
    <Button size="small" sx={pill} disabled={busy || reading} onClick={close}>取消</Button>
    <Button size="small" sx={pill} variant="contained" onClick={submit} disabled={busy || reading || !!text.trim() || !rows.length || errors.some(Boolean) || activeProfile !== profileId}>{busy ? '排队中...' : '导入文件'}</Button>
  </>}>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>目标：s3://{bucket}/{prefix}{initialPath || ''}</Typography>
      <Typography variant="body2" color="text.secondary">文件会经过此计算机并使用临时磁盘空间。URL 和请求头仅在本次会话中保留。仅支持公开互联网来源。</Typography>
      <TextField label="源 URL" multiline minRows={3} maxRows={6} fullWidth value={text} onChange={e => setText(e.target.value)} disabled={busy || reading} helperText="每行一个 URL。先添加链接进行审核，再执行导入。不会更改任何 S3 权限。" />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" sx={pill} variant="outlined" disabled={busy || reading || !text.trim()} onClick={() => { try { add(text, 'text'); } catch (e) { setError(String(e)); } }}>添加链接</Button>
        <Button size="small" sx={pill} disabled={busy || reading} onClick={() => input.current?.click()}>导入 CSV / JSON</Button>
        <input ref={input} type="file" accept=".csv,.json" aria-label="导入 URL 文件" style={{ display: 'none' }} onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          setReading(true);
          try { if (file.size > MAX_MANIFEST_BYTES) throw new Error('导入文件超过 2 MiB。'); if (!/\.(csv|json)$/i.test(file.name)) throw new Error('请选择 CSV 或 JSON 文件。'); const content = await file.text(); if (alive.current) add(content, file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'); }
          catch (e) { if (alive.current) setError(String(e)); }
          finally { if (alive.current) setReading(false); }
        }} />
        {reading && <CircularProgress size={16} />}
      </Box>
      <Typography variant="caption" color="text.secondary">CSV 需要 url 列。JSON 可以接受 URL 数组或对象数组。可选字段：path、replace、headers、sha256、max_bytes、max_attempts。最多 {MAX_URL_IMPORTS} 个文件 / 2 MiB。</Typography>
      {rows.length > 0 && <>
        <Typography variant="body2" fontWeight={600}>待审核 {rows.length} 个文件</Typography>
        {rows.slice((page - 1) * 10, page * 10).map(row => {
          const rowError = errors[rows.indexOf(row)];
          let host = '无效 URL'; try { host = new URL(row.entry.url).host; } catch { /* validated below */ }
          return <Box key={row.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5, minWidth: 0 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField fullWidth size="small" label="目标文件名 / 路径" value={row.entry.path} disabled={busy || !!initialPath} onChange={e => update(row.id, { path: e.target.value })} />
              <IconButton size="small" aria-label={`配置 ${row.entry.path || '文件'}`} aria-expanded={row.expanded} disabled={busy} onClick={() => setRows(current => current.map(r => r.id === row.id ? { ...r, expanded: !r.expanded } : r))}>{row.expanded ? <ExpandLess /> : <ExpandMore />}</IconButton>
              <IconButton size="small" aria-label={`从导入中移除 ${row.entry.path || '文件'}`} disabled={busy} onClick={() => { setRows(current => current.filter(r => r.id !== row.id)); setPage(1); }}><Close fontSize="small" /></IconButton>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: .5, overflowWrap: 'anywhere' }}>{host} · {row.entry.replace ? '仅在目标未变更时替换' : '不替换已存在的文件'}</Typography>
            {row.expanded && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1.5 }}>
              <TextField size="small" label="源 URL" type="password" autoComplete="off" fullWidth value={row.entry.url} disabled={busy} onChange={e => update(row.id, { url: e.target.value })} helperText="为保护签名 URL 的令牌而隐藏。若已过期，请在此粘贴新的 URL。" />
              <FormControlLabel control={<Checkbox size="small" disabled={busy} checked={row.entry.replace} onChange={(_, checked) => update(row.id, { replace: checked })} />} label="允许替换此目标文件" />
              <TextField size="small" label="最大下载大小 (GiB)" type="number" value={Number.isFinite(row.entry.max_bytes) ? row.entry.max_bytes / 1024 ** 3 : ''} disabled={busy} onChange={e => update(row.id, { max_bytes: Math.round(Number(e.target.value) * 1024 ** 3) })} helperText={`默认 ${DEFAULT_URL_LIMIT / 1024 ** 3} GiB。大文件请适当调大。需要有可用的临时磁盘空间。`} />
              <TextField size="small" label="预期的 SHA-256（可选）" value={row.entry.sha256 || ''} disabled={busy} onChange={e => update(row.id, { sha256: e.target.value || null })} />
              <TextField size="small" label="下载尝试次数" type="number" value={row.entry.max_attempts} disabled={busy} onChange={e => update(row.id, { max_attempts: Number(e.target.value) })} helperText="1 到 5 次，包含首次尝试。仅临时性下载失败会自动重试。" />
              <TextField size="small" label="源请求头（JSON，可选）" multiline minRows={2} value={row.headerText} disabled={busy} autoComplete="off" onChange={e => setRows(current => current.map(r => r.id === row.id ? { ...r, headerText: e.target.value } : r))} helperText='示例：{"Authorization":"Bearer token"}。重定向时不会将请求头发送到其他源。' />
            </Box>}
            {rowError && <Alert severity="error" sx={{ mt: 1 }}>{rowError}</Alert>}
          </Box>;
        })}
        {rows.length > 10 && <Pagination size="small" count={Math.ceil(rows.length / 10)} page={page} onChange={(_, value) => setPage(value)} />}
      </>}
      {rows.some(r => r.entry.replace) && <Alert severity="warning">你已允许替换部分文件。仅当目标 ETag 仍与排队时校验的结果一致时，这些文件才会被替换。</Alert>}
      {busy && <Typography role="status" variant="body2">正在检查替换目标并排队导入...</Typography>}
      {activeProfile !== profileId && <Alert severity="warning">导入前请先切换回此传输对应的连接。</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  </BaseDialog><ConfirmDialog open={discard} title="放弃导入草稿？" message="这些 URL 尚未排队。要放弃草稿还是继续审核？" confirmLabel="放弃草稿" cancelLabel="继续审核" onClose={() => setDiscard(false)} onConfirm={onClose} /></>;
}
