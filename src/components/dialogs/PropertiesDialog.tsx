import {
  Button,
  Tabs,
  Tab,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Paper,
  CircularProgress,
  Chip,
  Autocomplete,
  TextField,
  Alert,
  alpha,
  useTheme,
} from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { operationsApi, ObjectMetadata } from '@/lib/tauri';
import { BaseDialog } from '../common/BaseDialog';
import { formatSize } from '@/lib/utils';
import { toast } from '@/store/toastStore';

const COMMON_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'text/css',
  'text/csv',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/pdf',
  'application/octet-stream',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'audio/mpeg',
  'video/mp4',
];

interface PropertiesDialogProps {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  bucketRegion?: string;
  objectKey: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index } = props;

  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && (
        <Box sx={{ py: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

export default function PropertiesDialog({ open, onClose, bucketName, bucketRegion, objectKey }: PropertiesDialogProps) {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<ObjectMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentType, setContentType] = useState('');
  const [savingContentType, setSavingContentType] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const theme = useTheme();
  const requestIdRef = useRef(0);

  const fetchMetadata = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await operationsApi.getObjectMetadata(bucketName, bucketRegion, objectKey);
      if (requestId === requestIdRef.current) {
        setMetadata(data);
        setContentType(data.content_type || 'application/octet-stream');
        setSaveError(null);
      }
    } catch (err) {
      const errorMsg = String(err);
      if (requestId === requestIdRef.current) {
        if (errorMsg.includes('Access Denied') || errorMsg.includes('403') || errorMsg.includes('权限')) {
            setError('访问被拒绝：你没有查看元数据的权限。');
        } else {
            setError(`加载属性失败：${errorMsg}`);
        }
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [bucketName, bucketRegion, objectKey]);

  useEffect(() => {
    if (open && bucketName && objectKey) {
      fetchMetadata();
    } else {
        setMetadata(null);
        setError(null);
        setContentType('');
        setSaveError(null);
        setTabValue(0);
    }
  }, [open, bucketName, objectKey, fetchMetadata]);

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleSaveContentType = async () => {
    const nextContentType = contentType.trim();
    if (!metadata || !nextContentType || nextContentType === metadata.content_type) return;

    setSavingContentType(true);
    setSaveError(null);
    try {
      await operationsApi.setObjectContentType(
        bucketName,
        bucketRegion,
        objectKey,
        nextContentType
      );
      await fetchMetadata();
      toast.success('内容类型已更新', `${objectKey} 现在使用 ${nextContentType}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingContentType(false);
    }
  };

  return (
    <BaseDialog 
      open={open} 
      onClose={onClose} 
      title={`属性：${objectKey.split('/').pop()}`}
      maxWidth="sm"
      actions={
        <Box sx={{ display: 'flex', width: '100%', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={onClose} disabled={savingContentType}>
            关闭
          </Button>
          <Button
            onClick={handleSaveContentType}
            variant="contained"
            startIcon={savingContentType ? <CircularProgress size={16} /> : <SaveIcon />}
            disabled={
              savingContentType
              || !contentType.trim()
              || !metadata
              || contentType.trim() === metadata.content_type
            }
          >
            {savingContentType ? '保存中…' : '保存内容类型'}
          </Button>
        </Box>
      }
    >
      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, gap: 2 }}>
           <CircularProgress size={32} />
           <Typography variant="body2" color="text.secondary">加载元数据中...</Typography>
        </Box>
      ) : error ? (
        <Box sx={{ p: 2 }}>
           <Typography color="error" variant="body1" align="center" sx={{ fontWeight: 600 }}>{error}</Typography>
        </Box>
      ) : metadata ? (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ borderBottom: 1, borderColor: alpha(theme.palette.divider, 0.5) }}>
              <Tabs 
                value={tabValue} 
                onChange={handleChange} 
                sx={{
                  '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minWidth: 100 },
                  '& .Mui-selected': { color: theme.palette.primary.main }
                }}
              >
                  <Tab label="常规" />
                  <Tab label="元数据" />
              </Tabs>
            </Box>
            
            <CustomTabPanel value={tabValue} index={0}>
                <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.3) }}>
                    <Table size="small">
                        <TableBody>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary', width: '35%' }}>键</TableCell>
                                <TableCell sx={{ wordBreak: 'break-all', fontWeight: 600 }}>{metadata.key}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>大小</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{formatSize(metadata.size)}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>内容类型</TableCell>
                                <TableCell>
                                  <Autocomplete
                                    freeSolo
                                    size="small"
                                    options={COMMON_CONTENT_TYPES}
                                    value={contentType}
                                    onChange={(_, value) => setContentType(value || '')}
                                    onInputChange={(_, value) => setContentType(value)}
                                    renderInput={(params) => (
                                      <TextField
                                        {...params}
                                        placeholder="application/octet-stream"
                                        inputProps={{ ...params.inputProps, 'aria-label': '对象内容类型' }}
                                      />
                                    )}
                                  />
                                </TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>修改时间</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{metadata.last_modified}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>ETag (MD5)</TableCell>
                                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 500, fontSize: '0.8rem' }}>{metadata.e_tag || '-'}</TableCell>
                            </TableRow>
                            <TableRow sx={{ '&:last-child td': { border: 0 } }}>
                                <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>存储类</TableCell>
                                <TableCell>
                                    <Chip 
                                      label={metadata.storage_class || 'STANDARD'} 
                                      size="small" 
                                      sx={{ 
                                        fontWeight: 600, 
                                        fontSize: '0.65rem',
                                        bgcolor: alpha(theme.palette.success.main, 0.1),
                                        color: theme.palette.success.main,
                                        border: '1px solid',
                                        borderColor: alpha(theme.palette.success.main, 0.2)
                                      }} 
                                    />
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                  更新内容类型会就地复制对象以替换其元数据。启用版本控制的存储桶可能会生成新的对象版本。
                </Typography>
                {saveError && <Alert severity="error" sx={{ mt: 1.5 }}>{saveError}</Alert>}
            </CustomTabPanel>
            
            <CustomTabPanel value={tabValue} index={1}>
                {Object.keys(metadata.user_metadata).length === 0 ? (
                    <Box sx={{ py: 4, textAlign: 'center', opacity: 0.6 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>未找到用户元数据。</Typography>
                    </Box>
                ) : (
                     <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.3) }}>
                        <Table size="small">
                            <TableBody>
                                {Object.entries(metadata.user_metadata).map(([key, value]) => (
                                     <TableRow key={key} sx={{ '&:last-child td': { border: 0 } }}>
                                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', width: '40%' }}>{key}</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>{value}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                     </TableContainer>
                )}
            </CustomTabPanel>
        </Box>
      ) : null}
    </BaseDialog>
  );
}
