import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BaseDialog } from '../common/BaseDialog';
import { ObjectCannedAcl, ObjectPermissions, operationsApi } from '@/lib/tauri';
import { toast } from '@/store/toastStore';

interface PermissionsDialogProps {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  bucketRegion?: string;
  objectKey: string;
  isFolder: boolean;
}

const ACL_OPTIONS: { value: ObjectCannedAcl; label: string }[] = [
  { value: 'private', label: '私有' },
  { value: 'public-read', label: '公共读' },
  { value: 'public-read-write', label: '公共读写' },
  { value: 'authenticated-read', label: '认证用户读' },
  { value: 'bucket-owner-read', label: '存储桶所有者读' },
  { value: 'bucket-owner-full-control', label: '存储桶所有者完全控制' },
  { value: 'aws-exec-read', label: 'AWS 执行读取' },
];

export default function PermissionsDialog({
  open,
  onClose,
  bucketName,
  bucketRegion,
  objectKey,
  isFolder,
}: PermissionsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<ObjectPermissions | null>(null);
  const [selectedAcl, setSelectedAcl] = useState<ObjectCannedAcl | ''>('');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const canEditAcl = permissions?.status === 'available';

  const fetchPermissions = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setPermissions(null);
    setSelectedAcl('');
    setError(null);
    try {
      const data = await operationsApi.getObjectPermissions(bucketName, bucketRegion, objectKey, isFolder);
      if (requestId === requestIdRef.current) {
        setPermissions(data);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [bucketName, bucketRegion, objectKey, isFolder]);

  useEffect(() => {
    if (open && bucketName && objectKey) {
      fetchPermissions();
    } else {
      setPermissions(null);
      setError(null);
      setSelectedAcl('');
    }
    return () => { requestIdRef.current += 1; };
  }, [open, bucketName, objectKey, fetchPermissions]);

  const handleSave = async () => {
    if (!bucketName || !objectKey || !selectedAcl || !canEditAcl || saving || loading) return;
    const requestId = requestIdRef.current;
    setSaving(true);
    setError(null);
    try {
      const result = await operationsApi.setObjectPermissions(bucketName, bucketRegion, objectKey, isFolder, selectedAcl);
      if (requestId !== requestIdRef.current) return;
      toast.success(`已更新 ${result.affected_count} 个对象的权限。`);
      await fetchPermissions();
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title={`权限：${objectKey.split('/').filter(Boolean).pop() || objectKey}`}
      maxWidth="md"
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>关闭</Button>
          <Button onClick={handleSave} variant="contained" disabled={loading || saving || !!error || !canEditAcl || !selectedAcl}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </>
      }
    >
      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, gap: 2 }}>
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary">加载权限中...</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {permissions && (
            <>
              {permissions.status !== 'available' && (
                <Alert severity={permissions.status === 'unsupported' ? 'warning' : 'error'}>
                  {permissions.message || '此对象不支持 ACL 权限。'}
                </Alert>
              )}

              {isFolder && (
                <Alert severity="info">
                  显示的授权来自此文件夹中的一个对象。保存会将所选 ACL 应用到该文件夹下的 {permissions.target_count.toLocaleString()} 个对象。
                </Alert>
              )}

              <Box>
                <Typography variant="subtitle2" color="text.secondary">所有者</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: 'break-all' }}>
                  {permissions.owner_display_name || permissions.owner_id || '未知'}
                </Typography>
              </Box>

              <FormControl fullWidth size="small" disabled={!canEditAcl || saving}>
                <InputLabel id="acl-select-label">新权限</InputLabel>
                <Select
                  labelId="acl-select-label"
                  label="新权限"
                  value={selectedAcl}
                  onChange={(event) => setSelectedAcl(event.target.value as ObjectCannedAcl)}
                >
                  <MenuItem value="" disabled>选择权限</MenuItem>
                  {ACL_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {permissions.status === 'available' && (
                <TableContainer component={Paper} elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>被授权者</TableCell>
                        <TableCell>类型</TableCell>
                        <TableCell>权限</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {permissions.grants.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} align="center">未找到授权。</TableCell>
                        </TableRow>
                      ) : permissions.grants.map((grant, index) => (
                        <TableRow key={`${grant.permission}-${grant.id || grant.uri || index}`}>
                          <TableCell sx={{ wordBreak: 'break-all' }}>
                            {grant.display_name || grant.email_address || grant.uri || grant.id || '未知'}
                          </TableCell>
                          <TableCell>{grant.grantee_type || '-'}</TableCell>
                          <TableCell>{grant.permission || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </Box>
      )}
    </BaseDialog>
  );
}
