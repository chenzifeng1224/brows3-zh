'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, LinearProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography, TextField, MenuItem } from '@mui/material';
import { FolderOpen } from '@mui/icons-material';
import { open } from '@tauri-apps/plugin-dialog';
import { BaseDialog } from '@/components/common/BaseDialog';
import { StyledCheckbox } from '@/components/common/StyledCheckbox';
import { syncApi, SyncPreview } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';
import { toast } from '@/store/toastStore';
import { formatSize } from '@/lib/utils';
import SaveSyncJob from './SaveSyncJob';
import { useSettingsStore } from '@/store/settingsStore';

interface Props { bucket: string; region?: string; prefix: string; profileId: string; onClose: () => void }

// The parent keys this dialog by destination and unmounts it on profile/navigation changes.
export default function FolderSyncDialog({ bucket, region, prefix, profileId, onClose }: Props) {
  const [folder, setFolder] = useState('');
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'start' | 'save' | null>(null);
  const [savingJob, setSavingJob] = useState(false);
  const bandwidth = useSettingsStore(state => state.transferBandwidthKiB) * 1024;
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(0);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [skipExisting, setSkipExisting] = useState(false);
  function invalidatePreview() { setPreview(null); setConfirmed(false); setError(''); setPage(0); }
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const replacements = (preview?.changed_files ?? 0) + (preview?.unverified_files ?? 0);
  const uploads = (preview?.new_files ?? 0) + replacements;
  const buttonSx = { borderRadius: '999px' };
  const secondarySx = { ...buttonSx, color: 'text.primary' };

  async function choose() {
    try {
      const path = await open({ directory: true, multiple: false, title: '选择要同步的文件夹' });
      if (alive.current && typeof path === 'string') { setFolder(path); setPreview(null); setConfirmed(false); setError(''); }
    } catch (e) { if (alive.current) setError(String(e)); }
  }
  async function compare() {
    setBusy('preview'); setError(''); setPreview(null); setConfirmed(false); setPage(0);
    try { const options = { include: include.split('\n').filter(line => line.length > 0), exclude: exclude.split('\n').filter(line => line.length > 0), skip_existing: skipExisting }; const result = await syncApi.preview(folder, bucket, region, prefix, profileId, options); if (alive.current) setPreview(result); }
    catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) setBusy(null); }
  }
  async function start() {
    if (!preview || busy) return;
    setBusy('start'); setError('');
    try {
      const count = await syncApi.start(preview.id, confirmed, profileId);
      void useTransferStore.getState().refreshJobs();
      toast.success(`${count} 个同步上传已排队。可在「上传」中查看进度。`);
      if (alive.current) onClose();
    } catch (e) { if (alive.current) { setError(String(e)); setPreview(null); setConfirmed(false); } }
    finally { if (alive.current) setBusy(null); }
  }

  return <BaseDialog open title="同步本地文件夹到 S3" onClose={() => { if (busy !== 'start' && busy !== 'save') onClose(); }} maxWidth="md" actions={<>
    <Button size="small" sx={secondarySx} disabled={busy === 'start' || busy === 'save'} onClick={onClose}>关闭</Button>
    <Button size="small" sx={secondarySx} variant="outlined" disabled={!folder || !!busy} onClick={compare}>{preview ? '刷新预览' : '预览变更'}</Button>
    <Button size="small" sx={buttonSx} variant="contained" disabled={!preview || !!busy || uploads === 0 || (replacements > 0 && !confirmed)} onClick={start}>开始同步</Button>
  </>}>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>将此文件夹的内容复制到下方目标。本地文件和仅远程的对象永远不会被删除。预览不会产生任何更改。</Typography>
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
      <Button size="small" sx={{ ...secondarySx, flexShrink: 0 }} startIcon={<FolderOpen />} variant="outlined" disabled={!!busy} onClick={choose}>选择文件夹</Button>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{folder || '未选择本地文件夹'}</Typography>
    </Box>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 2 }}>目标：s3://{bucket}/{prefix}</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2, mb: 2 }}>
      <TextField label="包含模式" size="small" multiline minRows={2} maxRows={4} disabled={!!busy} value={include} onChange={e => { setInclude(e.target.value); invalidatePreview(); }} helperText="每行一个。留空则包含所有文件。" />
      <TextField label="排除模式" size="small" multiline minRows={2} maxRows={4} disabled={!!busy} value={exclude} onChange={e => { setExclude(e.target.value); invalidatePreview(); }} helperText="每行一个。排除规则优先。" />
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>相对于所选文件夹的区分大小写路径。根目录使用 *.txt，所有层级使用 **/*.txt，整个文件夹使用 cache/**。空行会被忽略；空格按字面匹配。</Typography>
    <TextField select fullWidth size="small" label="已存在的对象" value={skipExisting ? 'skip' : 'replace'} disabled={!!busy} onChange={e => { setSkipExisting(e.target.value === 'skip'); invalidatePreview(); }} sx={{ mb: 2 }}>
      <MenuItem value="replace">确认后替换已更改的文件</MenuItem>
      <MenuItem value="skip">跳过所有已存在的对象</MenuItem>
    </TextField>
    {folder && <Button size="small" sx={{ ...secondarySx, mb: 2 }} disabled={!!busy} onClick={() => setSavingJob(value => !value)}>{savingJob ? '隐藏任务设置' : '保存为任务'}</Button>}
    {folder && savingJob && <SaveSyncJob blocked={busy === 'preview' || busy === 'start'} key={JSON.stringify([folder, include, exclude, skipExisting, bandwidth])} config={{ local_path: folder, profile_id: profileId, bucket, region: region ?? null, prefix, options: { include: include.split('\n').filter(Boolean), exclude: exclude.split('\n').filter(Boolean), skip_existing: skipExisting }, bandwidth }} onBusy={value => setBusy(value ? 'save' : null)} />}
    {busy && <Box role="status" sx={{ mb: 2 }}><LinearProgress /><Typography variant="body2" sx={{ mt: 1 }}>{busy === 'preview' ? '正在读取本地文件并比对 S3 对象。较大的文件夹可能需要几分钟。' : busy === 'save' ? '保存任务中...' : '正在排队同步上传...'}</Typography></Box>}
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {preview && <>
      <Typography variant="body2" sx={{ mb: 1 }}>新增 {preview.new_files}，变更 {preview.changed_files}，未校验 {preview.unverified_files}，未变化 {preview.unchanged_files}，已过滤 {preview.filtered_files ?? 0}，已跳过 {preview.skipped_files ?? 0}。上传：{formatSize(preview.upload_bytes)}。</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>将保留 {preview.remote_only_files} 个仅远程对象。预览在 15 分钟后过期。</Typography>
      {preview.unverified_files > 0 && <Alert severity="warning" sx={{ mb: 2 }}>部分对象没有可比较的内容哈希，包括分片上传或经 KMS 加密的对象。即使内容可能相同，它们也会被重新上传。</Alert>}
      {uploads === 0 && <Alert severity="success" sx={{ mb: 2 }}>{preview.entries.length ? '按当前规则无需上传。请查看下方的操作。' : '此本地文件夹中没有文件，无需上传。'}</Alert>}
      {preview.entries.length > 0 && <Table size="small" aria-label="同步预览" sx={{ tableLayout: 'fixed', width: '100%' }}>
        <TableHead><TableRow><TableCell>对象</TableCell><TableCell sx={{ width: 105 }}>操作</TableCell><TableCell align="right" sx={{ width: 90 }}>大小</TableCell></TableRow></TableHead>
        <TableBody>{preview.entries.slice(page * 50, (page + 1) * 50).map(entry => <TableRow key={entry.key}><TableCell sx={{ overflowWrap: 'anywhere' }}>{entry.key}</TableCell><TableCell>{entry.action}</TableCell><TableCell align="right">{formatSize(entry.size)}</TableCell></TableRow>)}</TableBody>
      </Table>}
      {preview.entries.length > 50 && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
        <Button size="small" sx={buttonSx} disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
        <Typography variant="body2">第 {page + 1} / {Math.ceil(preview.entries.length / 50)} 页</Typography>
        <Button size="small" sx={buttonSx} disabled={(page + 1) * 50 >= preview.entries.length} onClick={() => setPage(p => p + 1)}>下一页</Button>
      </Box>}
      {replacements > 0 && <FormControlLabel sx={{ mt: 2, ml: 0, gap: 1, alignItems: 'flex-start' }} control={<StyledCheckbox aria-label="确认替换已存在的对象" checked={confirmed} onChange={e => { if (!busy) setConfirmed(e.target.checked); }} />} label={`用这些本地文件替换 ${replacements} 个已存在的对象。若存储桶未启用版本控制，原有内容可能无法恢复。`} />}
    </>}
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>最多 10,000 个本地文件。不会跟随符号链接。上传会使用临时磁盘空间来校验预览的内容。可能产生 S3 请求和传输费用。</Typography>
  </BaseDialog>;
}
