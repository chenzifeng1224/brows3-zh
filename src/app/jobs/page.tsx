'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Divider, Typography } from '@mui/material';
import { Schedule } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { jobsApi, SavedJob } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';
import { BaseDialog } from '@/components/common/BaseDialog';

const buttonSx = { borderRadius: '999px', color: 'text.primary' };
const date = (time: number) => new Date(time * 1000).toLocaleString();

export default function JobsPage() {
  const [jobs, setJobs] = useState<SavedJob[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<SavedJob | null>(null);
  const [cancelling, setCancelling] = useState<SavedJob | null>(null);
  const profiles = useProfileStore(state => state.profiles);
  const router = useRouter();
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try { const result = await jobsApi.list(); if (alive.current) { setJobs(result); setError(''); } }
    catch (e) { if (alive.current) setError(String(e)); }
  }, []);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { await refresh(); if (!stopped) timer = setTimeout(poll, 2000); }
    void poll();
    return () => { alive.current = false; stopped = true; clearTimeout(timer); };
  }, [refresh]);
  const [actionError, setActionError] = useState('');
  const actionLock = useRef(false);
  async function act(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setActionError('');
    try { await action(); if (alive.current) { setDeleting(null); setCancelling(null); await refresh(); } }
    catch (e) { if (alive.current) setActionError(String(e)); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  }
  return <Box sx={{ p: 1, mt: 1, minWidth: 0 }}>
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2 }}><Schedule color="primary" /><Typography variant="h4" component="h1" fontWeight={700}>任务</Typography></Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: '75ch' }}>跨配置保存的文件夹到 S3 的同步任务。仅在 Brows3 打开时运行。关闭期间错过的运行、中断的运行和失败会暂停其调度。文件和仅远程对象永远不会被删除。</Typography>
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
      <Button size="small" sx={buttonSx} variant="outlined" onClick={() => router.push('/')}>浏览存储桶</Button>
      <Button size="small" sx={buttonSx} onClick={() => router.push('/uploads')}>查看上传</Button>
      <Button size="small" sx={buttonSx} disabled={busy} onClick={() => void refresh()}>刷新任务</Button>
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>要添加任务：打开一个存储桶，选择 上传 → 同步本地文件夹，然后保存为任务。要修改配置，请删除后重新保存。暂停会停止后续运行；在「上传」中可取消排队或进行中的传输。</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {actionError && !deleting && !cancelling && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
    {!jobs && !error && <Box role="status" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><CircularProgress size={18} />加载任务中...</Box>}
    {jobs?.length === 0 && <Typography sx={{ py: 3 }}>还没有已保存的任务。保存一个文件夹同步即可在此重复执行。</Typography>}
    {jobs?.map(job => {
      const active = !!job.last_run && job.last_run.finished_at === null;
      const profile = profiles.find(p => p.id === job.config.profile_id);
      return <Box component="section" aria-label={job.config.name} key={job.id} sx={{ py: 2, borderTop: '1px solid', borderColor: 'divider', overflowWrap: 'anywhere' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
          <Box sx={{ minWidth: 0 }}><Typography variant="h6" component="h2">{job.config.name}</Typography><Typography variant="body2" color="text.secondary">{profile?.name ?? '配置不可用'} · {job.config.interval_minutes ? `完成后每 ${job.config.interval_minutes} 分钟运行一次` : '仅手动'}{job.config.interval_minutes && !job.enabled ? ' · 已暂停' : ''}</Typography></Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="small" sx={buttonSx} variant="outlined" disabled={busy || active || !profile} onClick={() => void act(() => jobsApi.run(job.id))}>立即运行</Button>
            {active && <Button size="small" sx={buttonSx} disabled={busy || job.last_run?.cancel_requested} onClick={() => { setActionError(''); setCancelling(job); }}>{job.last_run?.cancel_requested ? '取消中...' : '取消本次运行'}</Button>}
            {job.config.interval_minutes && <Button size="small" sx={buttonSx} disabled={busy || (!job.enabled && !profile)} onClick={() => void act(() => jobsApi.setEnabled(job.id, !job.enabled))}>{job.enabled ? '暂停' : '恢复'}</Button>}
            <Button size="small" sx={buttonSx} disabled={busy || active} onClick={() => { setActionError(''); setDeleting(job); }}>删除</Button>
          </Box>
        </Box>
        <Typography variant="body2">{job.config.local_path}</Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>目标：s3://{job.config.bucket}/{job.config.prefix}</Typography>
        <Typography variant="body2" color="text.secondary">{job.config.options.skip_existing ? '跳过已有对象' : '替换变更或未验证的对象'} · {job.config.bandwidth ? `每个传输 ${job.config.bandwidth / 1024} KiB/s` : '不限带宽'}</Typography>
        {(job.config.options.include.length > 0 || job.config.options.exclude.length > 0) && <Typography variant="body2" color="text.secondary">包含：{job.config.options.include.join(', ') || '所有文件'}。排除：{job.config.options.exclude.join(', ') || '无'}。</Typography>}
        <Typography variant="body2" sx={{ mt: 1 }}>下次运行：{active ? '本次运行完成后（如已启用）' : job.next_run ? date(job.next_run) : '未安排'}</Typography>
        {job.last_run ? <Typography variant="body2" role="status" color={['Failed', 'Interrupted', 'Cancelled', 'Missed'].includes(job.last_run.status) ? 'error.main' : 'text.primary'} sx={{ mt: 0.5 }}>{job.last_run.status} · {date(job.last_run.finished_at ?? job.last_run.started_at)}. {job.last_run.message}</Typography> : <Typography variant="body2" color="text.secondary">尚未运行。</Typography>}
      </Box>;
    })}
    <Divider />
    {cancelling && <BaseDialog open title="取消此任务运行？" onClose={() => { if (!busy) setCancelling(null); }} actions={<><Button size="small" sx={buttonSx} disabled={busy} onClick={() => setCancelling(null)}>保持运行</Button><Button size="small" color="error" sx={{ borderRadius: '999px' }} disabled={busy} onClick={() => void act(() => jobsApi.cancel(cancelling.id))}>取消运行</Button></>}>
      <Typography>取消本次运行的排队和进行中传输，并暂停其调度？已完成的上传将保留。已在进行中的本地扫描可能需要几分钟才能停止。</Typography>
      {actionError && <Alert severity="error" sx={{ mt: 2 }}>{actionError}</Alert>}
    </BaseDialog>}
    {deleting && <BaseDialog open title="删除已保存任务？" onClose={() => { if (!busy) setDeleting(null); }} actions={<><Button size="small" sx={buttonSx} disabled={busy} onClick={() => setDeleting(null)}>保留任务</Button><Button size="small" color="error" sx={{ borderRadius: '999px' }} disabled={busy} onClick={() => void act(() => jobsApi.delete(deleting.id))}>删除任务</Button></>}>
      <Typography sx={{ overflowWrap: 'anywhere' }}>删除 {deleting.config.name} 及其调度？这不会删除本地文件、S3 对象或传输历史。</Typography>
      {actionError && <Alert severity="error" sx={{ mt: 2 }}>{actionError}</Alert>}
    </BaseDialog>}
  </Box>;
}
