'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, LinearProgress, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { BaseDialog } from '@/components/common/BaseDialog';
import { StyledCheckbox } from '@/components/common/StyledCheckbox';
import { versionsApi, type ObjectVersion, type VersionHistory } from '@/lib/tauri';
import { formatSize } from '@/lib/utils';
import { useTransferStore } from '@/store/transferStore';
import { toast } from '@/store/toastStore';

interface Props { bucket: string; region: string; profileId: string; initialKey: string; onClose: () => void }
const buttonSx = { borderRadius: '999px' };
const secondarySx = { ...buttonSx, color: 'text.primary' };
const dateLabel = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : '未提供';

export default function VersionHistoryDialog({ bucket, region, profileId, initialKey, onClose }: Props) {
  const [key, setKey] = useState(initialKey);
  const [pages, setPages] = useState<VersionHistory[]>([]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ObjectVersion | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'load' | 'restore' | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const pending = useRef(false);
  const initialized = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = pages[0]?.versions.find(v => v.is_latest);
  const versioning = pages[0]?.versioning;
  const visible = pages[page];

  const load = useCallback(async (previous: VersionHistory[] = []) => {
    if (!key || pending.current) return;
    pending.current = true; setBusy('load'); setError(''); setSelected(null); setConfirmed(false);
    if (!previous.length) { setPages([]); setPage(0); }
    try {
      const result = await versionsApi.list(bucket, region, key, previous.at(-1)?.next ?? null, profileId);
      if (result.next && previous.some(p => p.next?.key_marker === result.next?.key_marker && p.next?.version_id_marker === result.next?.version_id_marker)) throw new Error('历史游标重复。请刷新历史。');
      if (alive.current) { setPages([...previous, result]); setPage(previous.length); }
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current = false; if (alive.current) setBusy(null); }
  }, [bucket, region, key, profileId]);
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; if (initialKey && !initialKey.endsWith('/')) void load(); }
  }, [initialKey, load]);

  async function restore() {
    if (!selected || !current || !confirmed || pending.current || versioning !== 'Enabled') return;
    pending.current = true; setBusy('restore'); setError('');
    try {
      await versionsApi.restore(bucket, region, key, selected.version_id, current.version_id, confirmed, profileId);
      void useTransferStore.getState().refreshJobs();
      toast.success('版本恢复已排队。可在「上传」中查看进度。');
      if (alive.current) onClose();
    } catch (e) {
      if (alive.current) { setError(String(e)); setPages([]); setSelected(null); setConfirmed(false); setPage(0); }
    } finally { pending.current = false; if (alive.current) setBusy(null); }
  }
  const confirmation = '用所选内容创建一个新的当前版本。现有版本和删除标记不会被删除。';
  return <BaseDialog open title="版本历史" maxWidth="md" onClose={onClose} closeDisabled={busy === 'restore'} actions={<>
    <Button size="small" sx={secondarySx} disabled={busy === 'restore'} onClick={onClose}>关闭</Button>
    <Button size="small" sx={buttonSx} variant="contained" disabled={!selected || !current || !confirmed || !!busy || versioning !== 'Enabled'} onClick={restore}>恢复所选版本</Button>
  </>}>
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
      <TextField label="精确对象键" value={key} size="small" fullWidth disabled={!!busy} helperText="输入包含文件夹在内的完整键，以查找现有或已删除的对象。" onChange={e => { setKey(e.target.value); setPages([]); setPage(0); setSelected(null); setConfirmed(false); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void load(); } }} inputProps={{ autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }} />
      <Button size="small" sx={{ ...secondarySx, flexShrink: 0, mt: 0.5 }} disabled={!key || !!busy} variant="outlined" onClick={() => void load()}>{pages.length ? '刷新' : '加载历史'}</Button>
    </Box>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 2 }}>对象：s3://{bucket}/{key}</Typography>
    {busy && <Box role="status" sx={{ mb: 2 }}><LinearProgress /><Typography variant="body2" sx={{ mt: 1 }}>{busy === 'load' ? '正在读取版本历史...' : '正在检查所选版本并排队恢复...'}</Typography></Box>}
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {versioning && versioning !== 'Enabled' && <Alert severity="warning" sx={{ mb: 2 }}>存储桶版本控制当前为 {versioning.toLowerCase()}。历史为只读。恢复需要先通过存储服务商启用版本控制。</Alert>}
    {current?.is_delete_marker && <Alert severity="info" sx={{ mb: 2 }}>此对象当前处于已删除状态。选择一个较早的数据版本即可恢复其内容，而不会移除删除标记。</Alert>}
    {visible && !visible.versions.length && <Alert severity="info">此页未找到该精确键的版本。</Alert>}
    {!!visible?.versions.length && <Table size="small" aria-label="对象版本" sx={{ tableLayout: 'fixed', width: '100%', '& .MuiTableCell-root': { overflowWrap: 'anywhere' } }}>
      <TableHead><TableRow><TableCell>版本 ID</TableCell><TableCell sx={{ width: 100 }}>状态</TableCell><TableCell sx={{ width: 125 }}>修改时间</TableCell><TableCell sx={{ width: 80 }} align="right">大小</TableCell><TableCell sx={{ width: 108 }}>恢复</TableCell></TableRow></TableHead>
      <TableBody>{visible.versions.map(v => <TableRow key={`${v.version_id}:${v.is_delete_marker}`} selected={selected?.version_id === v.version_id}>
        <TableCell sx={{ overflowWrap: 'anywhere' }}>{v.version_id}</TableCell>
        <TableCell>{v.is_delete_marker ? (v.is_latest ? '当前删除标记' : '删除标记') : (v.is_latest ? '当前版本' : '较早版本')}</TableCell>
        <TableCell sx={{ overflowWrap: 'anywhere' }}>{dateLabel(v.modified)}</TableCell>
        <TableCell align="right">{v.size === null ? <span aria-label="不适用">N/A</span> : formatSize(v.size)}</TableCell>
        <TableCell><Button size="small" sx={secondarySx} aria-label={`选择版本 ${v.version_id}`} aria-pressed={selected?.version_id === v.version_id} disabled={!!busy || v.is_latest || v.is_delete_marker || !current || versioning !== 'Enabled'} onClick={() => { setSelected(v); setConfirmed(false); }}>{selected?.version_id === v.version_id ? '已选择' : '选择'}</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table>}
    {visible && <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mt: 1 }}>
      <Button size="small" sx={secondarySx} disabled={page === 0 || !!busy} onClick={() => { setPage(p => p - 1); setSelected(null); setConfirmed(false); }}>上一页</Button>
      <Typography variant="body2">第 {page + 1} 页</Typography>
      <Button size="small" sx={secondarySx} disabled={!!busy || (page === pages.length - 1 && (!visible.next || pages.length >= 100))} onClick={() => { if (page < pages.length - 1) { setPage(p => p + 1); setSelected(null); setConfirmed(false); } else void load(pages); }}>下一页</Button>
    </Box>}
    {pages.length >= 100 && visible?.next && <Alert severity="info" sx={{ mt: 1 }}>已加载到 10,000 条历史记录上限。请使用服务商的工具查看更早的版本。</Alert>}
    {selected && <Box sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 1 }}>恢复版本：{selected.version_id}</Typography>
      <FormControlLabel sx={{ ml: 0, gap: 1, alignItems: 'flex-start' }} control={<StyledCheckbox aria-label={confirmation} checked={confirmed} onChange={e => { if (!busy) setConfirmed(e.target.checked); }} />} label={confirmation} />
    </Box>}
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>恢复内容和内容元数据。对已存在的对象，保留当前权限、标签、加密和保留设置；对已删除的对象，则应用存储桶默认设置。会使用临时磁盘空间和本机的网络连接。可能产生请求和传输费用。</Typography>
  </BaseDialog>;
}
