'use client';
import { useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { Edit, DeleteOutline } from '@mui/icons-material';
import { TransferJob } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';
import UrlImportDialog from '@/components/dialogs/UrlImportDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

export default function UrlImportActions({ job }: { job: TransferJob }) {
  const [edit, setEdit] = useState(false), [remove, setRemove] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!job.url_import) return null;
  const terminal = job.status === 'Completed' || job.status === 'Cancelled' || typeof job.status === 'object';
  return <>
    {terminal && job.status !== 'Completed' && <Tooltip title="编辑来源并重试"><IconButton size="small" aria-label="编辑导入来源" onClick={() => setEdit(true)}><Edit fontSize="small" /></IconButton></Tooltip>}
    {terminal && <Tooltip title="从列表中移除"><IconButton size="small" aria-label="从列表中移除导入任务" onClick={() => { setError(''); setRemove(true); }}><DeleteOutline fontSize="small" /></IconButton></Tooltip>}
    {edit && <UrlImportDialog bucket={job.bucket} region={job.bucket_region || undefined} prefix="" initialPath={job.key} initialLimits={job.url_import} profileId={job.profile_id} onClose={() => setEdit(false)} />}
    <ConfirmDialog open={remove} title="从列表中移除传输？" message={<>仅移除这条历史记录，S3 中的文件不会被删除。{error && <span role="alert">{error}</span>}</>} confirmLabel="从列表中移除" isLoading={busy} onClose={() => { if (!busy) setRemove(false); }} onConfirm={async () => {
      if (busy) return; setBusy(true);
      try { await useTransferStore.getState().removeJob(job.id); setRemove(false); } catch (e) { setError(String(e)); } finally { setBusy(false); }
    }} />
  </>;
}
