'use client';

import { useRef, useState, useEffect } from 'react';
import { Alert, Box, Button, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { StyledCheckbox } from '@/components/common/StyledCheckbox';
import { jobsApi, SavedJobConfig } from '@/lib/tauri';
import { toast } from '@/store/toastStore';

export default function SaveSyncJob({ config, onBusy, blocked }: {
  config: Omit<SavedJobConfig, 'name' | 'interval_minutes' | 'allow_replacement'>;
  onBusy: (busy: boolean) => void;
  blocked: boolean;
}) {
  const [name, setName] = useState('');
  const [interval, setInterval] = useState(0);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save() {
    if (busy || blocked || !approved) return;
    setBusy(true); onBusy(true); setError('');
    try {
      await jobsApi.save({ ...config, name: name.trim(), interval_minutes: interval || null, allow_replacement: !config.options.skip_existing }, approved);
      toast.success('任务已保存。可在「任务」中管理。');
      if (alive.current) setSaved(true);
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) { setBusy(false); onBusy(false); } }
  }
  if (saved) return <Alert severity="success" sx={{ mb: 2 }}>任务已保存。打开「任务」即可运行、暂停其调度或查看运行结果。</Alert>;
  return <Box component="fieldset" disabled={busy || blocked} sx={{ border: 0, borderTop: '1px solid', borderColor: 'divider', pt: 2, px: 0, mx: 0, mb: 2, minWidth: 0 }}>
    <Typography component="h3" variant="subtitle2" sx={{ mb: 1 }}>将此同步保存为任务</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2, mb: 1 }}>
      <TextField size="small" label="任务名称" value={name} disabled={busy} inputProps={{ maxLength: 120 }} onChange={e => { setName(e.target.value); setApproved(false); }} />
      <TextField select size="small" label="调度" value={interval} disabled={busy} onChange={e => { setInterval(Number(e.target.value)); setApproved(false); }}>
        <MenuItem value={0}>仅手动</MenuItem><MenuItem value={15}>每 15 分钟</MenuItem><MenuItem value={60}>每小时</MenuItem><MenuItem value={1440}>每天</MenuItem><MenuItem value={10080}>每周</MenuItem>
      </TextField>
    </Box>
    <Typography variant="body2" color="text.secondary">仅在 Brows3 打开时运行。首次调度运行在所选间隔后开始；后续间隔在每次运行结束后开始。关闭期间错过的运行会暂停，不会补跑。失败会暂停调度。</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>每次运行都会用这些筛选规则比对最新内容。每次传输的带宽：{config.bandwidth ? `${config.bandwidth / 1024} KiB/s` : '不限'}。要修改已保存的配置，请删除后重新保存任务。</Typography>
    <FormControlLabel disabled={busy} sx={{ ml: 0, gap: 1, my: 1, alignItems: 'flex-start' }} control={<StyledCheckbox aria-label="批准已保存的任务" checked={approved} onChange={e => { if (!busy) setApproved(e.target.checked); }} />} label={config.options.skip_existing
      ? '我批准将来从此文件夹上传到该目标。已存在的对象将被跳过。可能产生 S3 费用。'
      : '我批准将来上传并替换已更改或未校验的对象，无需再次确认。若存储桶未启用版本控制，原有内容可能无法恢复。可能产生 S3 费用。'} />
    {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
    <Button size="small" variant="outlined" sx={{ borderRadius: '999px', color: 'text.primary' }} disabled={!name.trim() || !approved || busy || blocked} onClick={save}>{busy ? '保存任务中...' : '保存任务'}</Button>
  </Box>;
}
