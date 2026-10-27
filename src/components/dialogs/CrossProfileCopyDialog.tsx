'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Typography } from '@mui/material';
import { BaseDialog } from '@/components/common/BaseDialog';
import { ClipboardItem } from '@/store/clipboardStore';
import { useProfileStore } from '@/store/profileStore';
import { useTransferStore } from '@/store/transferStore';
import { operationsApi } from '@/lib/tauri';
import { toast } from '@/store/toastStore';

interface Props { items: ClipboardItem[]; bucket: string; region: string; prefix: string; profileId: string; onClose: () => void }

export default function CrossProfileCopyDialog({ items, bucket, region, prefix, profileId, onClose }: Props) {
  const profiles = useProfileStore(state => state.profiles);
  const source = profiles.find(p => p.id === items[0]?.profileId);
  const destination = profiles.find(p => p.id === profileId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function start() {
    if (pending.current || !source || !destination) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const count = await operationsApi.copyBetweenProfiles(items, bucket, region, prefix, profileId);
      void useTransferStore.getState().refreshJobs();
      toast.success(count ? `${count} 个复制任务已排队。可在「上传」中查看进度。` : '所选文件夹中没有对象，未排队任何复制任务。');
      if (alive.current) onClose();
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const buttonSx = { borderRadius: '999px' };
  return <BaseDialog open title="跨配置复制" onClose={onClose} closeDisabled={busy} actions={<>
    <Button size="small" sx={{ ...buttonSx, color: 'text.primary' }} disabled={busy} onClick={onClose}>取消</Button>
    <Button size="small" sx={buttonSx} variant="contained" disabled={busy || !source || !destination} onClick={start}>复制到目标</Button>
  </>}>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 1 }}>来源：{source?.name || '源配置不可用'}</Typography>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 2 }}>目标：{destination?.name || '目标配置不可用'} / s3://{bucket}/{prefix}</Typography>
    <Typography variant="body2">已选 {items.length} 项。文件夹会包含其内容。</Typography>
    <Box component="ul" sx={{ pl: 2.5, my: 1, overflowWrap: 'anywhere' }}>{items.slice(0, 5).map(item => <Typography component="li" variant="body2" key={`${item.bucket}/${item.key}`}>s3://{item.bucket}/{item.key}</Typography>)}</Box>
    {items.length > 5 && <Typography variant="body2" color="text.secondary">另有 {items.length - 5} 个已选项。</Typography>}
    <Alert severity="info" sx={{ my: 2 }}>源对象保持不变。已存在的目标对象会安全失败，不会被替换。复制使用本机的网络连接和临时磁盘空间。可能产生 S3 请求和传输费用。</Alert>
    <Typography variant="body2" color="text.secondary">仅复制内容和内容元数据，不复制标签、权限、版本历史或保留设置。加密和存储类由目标端的默认设置决定。</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>每批最多 10,000 个对象。「上传」中的进度包含下载和上传流量。可在那里取消排队中或进行中的复制；已完成的复制会保留。</Typography>
    {(!source || !destination) && <Alert severity="error" sx={{ mt: 2 }}>某个配置已不可用。请关闭此对话框后重新复制这些项目。</Alert>}
    {busy && <Box role="status" sx={{ mt: 2 }}><LinearProgress /><Typography variant="body2" sx={{ mt: 1 }}>正在检查源对象并排队复制。选择较多时可能需要几分钟。</Typography></Box>}
    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
  </BaseDialog>;
}
