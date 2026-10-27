'use client';

import { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  List, 
  ListItem, 
  ListItemText, 
  ListItemIcon,
  ListItemSecondaryAction, 
  Select, 
  MenuItem, 
  TextField, 
  Slider, 
  Switch,
  Container,
  Button,
  Chip,
  Divider,
  Alert,
} from '@mui/material';
import {
  Update as UpdateIcon,
  Folder as FolderIcon,
  DeleteSweep as ClearIcon,
  MonitorHeart as MonitorIcon,
  CheckCircle as SuccessIcon,
  ErrorOutline as ErrorIcon,
  Info as InfoIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import {
  MAX_TEXT_PREVIEW_SIZE_MB,
  MIN_TEXT_PREVIEW_SIZE_MB,
  useSettingsStore,
} from '@/store/settingsStore';
import { useAppStore } from '@/store/appStore';
import { useMonitorStore } from '@/store/monitorStore';
import { invalidateBucketCache } from '@/hooks/useBuckets';
import { toast } from '@/store/toastStore';
import { bucketApi, copyToClipboard, invalidateCache, isTauri, logApi, transferApi, type LogFileInfo } from '@/lib/tauri';

export default function SettingsPage() {
  // Theme is controlled by appStore (used by the actual app)
  const { themeMode, setThemeMode, clearDiscoveredRegions } = useAppStore();
  // Other settings from settingsStore
  const { 
    defaultRegion, setDefaultRegion, 
    maxConcurrentTransfers, setMaxConcurrentTransfers,
    transferBandwidthKiB, setTransferBandwidthKiB,
    maxTextPreviewSizeMb, setMaxTextPreviewSizeMb,
    autoRefreshOnFocus, setAutoRefreshOnFocus
  } = useSettingsStore();
  
  const [version, setVersion] = useState<string>('...');
  const [appDataDir, setAppDataDir] = useState<string>('加载中...');
  const [logFileInfo, setLogFileInfo] = useState<LogFileInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [pendingTransferConcurrency, setPendingTransferConcurrency] = useState(maxConcurrentTransfers);
  const [pendingPreviewLimit, setPendingPreviewLimit] = useState(maxTextPreviewSizeMb);
  const [bandwidth, setBandwidth] = useState(String(transferBandwidthKiB));
  const [savingBandwidth, setSavingBandwidth] = useState(false);
  const [bandwidthError, setBandwidthError] = useState('');
  const bandwidthValue = Number(bandwidth);
  const validBandwidth = /^\d+$/.test(bandwidth) && Number.isSafeInteger(bandwidthValue) && (bandwidthValue === 0 || (bandwidthValue >= 64 && bandwidthValue <= 1048576));
  useEffect(() => { setBandwidth(String(transferBandwidthKiB)); }, [transferBandwidthKiB]);
  async function applyBandwidth() {
    if (!validBandwidth || savingBandwidth) return;
    setSavingBandwidth(true); setBandwidthError('');
    try {
      if (isTauri()) await transferApi.setBandwidth(bandwidthValue * 1024);
      setTransferBandwidthKiB(bandwidthValue);
      toast.success('带宽限制已保存', '适用于新加入队列的传输。已有任务沿用其原有限制。');
    } catch (e) { setBandwidthError(String(e)); }
    finally { setSavingBandwidth(false); }
  }
  
  useEffect(() => {
    if (!isTauri()) {
      setVersion('Web');
      setAppDataDir('仅桌面应用可用');
      return;
    }

    // Get app version
    import('@tauri-apps/api/app').then(({ getVersion }) => {
      getVersion().then(setVersion).catch(() => setVersion('未知'));
    });
    
    // Get app data directory
    import('@tauri-apps/api/path').then(({ appDataDir: getAppDataDir }) => {
      getAppDataDir().then(setAppDataDir).catch(() => setAppDataDir('未知'));
    });

    logApi.getLogFileInfo()
      .then(setLogFileInfo)
      .catch(() => setLogFileInfo(null));
  }, []);

  useEffect(() => {
    setPendingTransferConcurrency(maxConcurrentTransfers);
  }, [maxConcurrentTransfers]);

  useEffect(() => {
    setPendingPreviewLimit(maxTextPreviewSizeMb);
  }, [maxTextPreviewSizeMb]);

  const handleClearCache = async () => {
    try {
      if (isTauri()) await bucketApi.refreshS3Client();
      invalidateBucketCache();
      clearDiscoveredRegions();
      invalidateCache();
      toast.success('缓存已清除', '存储桶列表、已发现区域和对象视图均已重置。');
    } catch (error) {
      toast.error('无法清除缓存', String(error));
    }
  };

  const handleCheckUpdate = async () => {
    if (!isTauri()) {
      toast.info('仅桌面应用可用', '更新检查仅在桌面应用中可用。');
      return;
    }

    setIsCheckingUpdate(true);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        toast.success('发现可用更新', `版本 ${update.version} 可用，将自动安装。`);
        await update.downloadAndInstall();
      } else {
        toast.info('已是最新版本', '你正在运行最新版本。');
      }
    } catch (err) {
      toast.error('更新检查失败', String(err));
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleCopyLogPath = async () => {
    if (!logFileInfo) return;

    try {
      await copyToClipboard(logFileInfo.log_file_path);
      toast.success('日志路径已复制');
    } catch (err) {
      toast.error('复制失败', String(err));
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Typography variant="h4">设置</Typography>
        <Chip label={`v${version}`} size="small" variant="outlined" />
      </Box>

      {/* Appearance Section */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>外观</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="主题" 
              secondary="选择你偏好的界面外观" 
            />
            <ListItemSecondaryAction>
              <Select
                size="small"
                value={themeMode}
                onChange={(e) => {
                  setThemeMode(e.target.value as 'light' | 'dark' | 'system');
                  toast.success('主题已更新', `已切换到${e.target.value === 'light' ? '浅色' : e.target.value === 'dark' ? '深色' : '跟随系统'}模式`);
                }}
                sx={{ minWidth: 120 }}
              >
                <MenuItem value="light">浅色</MenuItem>
                <MenuItem value="dark">深色</MenuItem>
                <MenuItem value="system">跟随系统</MenuItem>
              </Select>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      {/* Defaults Section */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>默认</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="默认区域" 
              secondary="当无法自动识别区域时，用作新建配置的默认区域" 
            />
            <ListItemSecondaryAction>
              <TextField 
                size="small" 
                variant="outlined" 
                value={defaultRegion} 
                onChange={(e) => setDefaultRegion(e.target.value)}
                sx={{ width: 150 }}
              />
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>性能与行为</Typography>
        </Box>
        <List>
          <ListItem divider>
            <ListItemText 
              primary="最大并发传输数" 
              secondary={`最多允许 ${pendingTransferConcurrency} 个上传/下载同时进行`} 
            />
            <Box sx={{ width: 200, mr: 2 }}>
               <Slider
                 value={pendingTransferConcurrency}
                 min={1}
                 max={20}
                 step={1}
                 valueLabelDisplay="auto"
                 onChange={(_, val) => setPendingTransferConcurrency(val as number)}
                 onChangeCommitted={(_, val) => {
                   const nextValue = val as number;
                   setPendingTransferConcurrency(nextValue);
                   if (nextValue !== maxConcurrentTransfers) {
                     setMaxConcurrentTransfers(nextValue);
                     toast.success('传输并发数已更新', `已设置为 ${nextValue}`);
                   }
                 }}
               />
            </Box>
          </ListItem>
          <ListItem divider sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
            <ListItemText primary="每个传输的带宽" secondary="限制每个新加入队列的上传或下载，包括同步、跨配置复制和恢复。已有任务沿用其原有限制。并发的每个任务各自获得该配额；这不是应用总限额。" />
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <TextField label="限制 (KiB/s)" size="small" value={bandwidth} disabled={savingBandwidth} onChange={e => { setBandwidth(e.target.value); setBandwidthError(''); }} inputProps={{ inputMode: 'numeric' }} error={!validBandwidth} helperText="0 表示不限速。否则范围为 64 到 1,048,576 KiB/s。" sx={{ flex: 1 }} />
              <Button size="small" variant="outlined" sx={{ borderRadius: '999px', color: 'text.primary', mt: 0.5 }} disabled={!validBandwidth || savingBandwidth || bandwidthValue === transferBandwidthKiB} onClick={applyBandwidth}>{savingBandwidth ? '保存中...' : '应用'}</Button>
            </Box>
            {bandwidthError && <Alert severity="error">{bandwidthError}</Alert>}
          </ListItem>
          <ListItem divider>
            <ListItemText
              primary="文本预览大小限制"
              secondary={`文本、HTML 和代码对象最多加载 ${pendingPreviewLimit} MB。图片、音频、视频和 PDF 采用流式加载，不占用该内存限制。`}
            />
            <Box sx={{ width: 200, mr: 2 }}>
              <Slider
                value={pendingPreviewLimit}
                min={MIN_TEXT_PREVIEW_SIZE_MB}
                max={MAX_TEXT_PREVIEW_SIZE_MB}
                step={1}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${value} MB`}
                onChange={(_, value) => setPendingPreviewLimit(value as number)}
                onChangeCommitted={(_, value) => {
                  const nextValue = value as number;
                  setPendingPreviewLimit(nextValue);
                  if (nextValue !== maxTextPreviewSizeMb) {
                    setMaxTextPreviewSizeMb(nextValue);
                    toast.success('预览限制已更新', `文本预览最多可使用 ${nextValue} MB`);
                  }
                }}
              />
            </Box>
          </ListItem>
          <ListItem>
            <ListItemText 
              primary="聚焦时自动刷新" 
              secondary="返回应用时自动刷新对象列表" 
            />
            <ListItemSecondaryAction>
              <Switch
                edge="end"
                checked={autoRefreshOnFocus}
                onChange={(e) => {
                  setAutoRefreshOnFocus(e.target.checked);
                  toast.success('行为已更新', `自动刷新已${e.target.checked ? '开启' : '关闭'}`);
                }}
              />
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      {/* Data & Storage Section */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>数据与存储</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemIcon>
              <FolderIcon color="action" />
            </ListItemIcon>
            <ListItemText 
              primary="应用数据位置" 
              secondary={appDataDir}
              secondaryTypographyProps={{ 
                component: 'code', 
                sx: { fontSize: '0.75rem', bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 1, display: 'inline-block', mt: 0.5 } 
              }}
            />
          </ListItem>
          <Divider />
          <ListItem>
            <ListItemIcon>
              <InfoIcon color="action" />
            </ListItemIcon>
            <ListItemText
              primary="诊断日志文件"
              secondary={logFileInfo?.log_file_path || (isTauri() ? '不可用' : '仅桌面应用可用')}
              secondaryTypographyProps={{
                component: 'code',
                sx: { fontSize: '0.75rem', bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 1, display: 'inline-block', mt: 0.5, maxWidth: '100%', overflowWrap: 'anywhere' }
              }}
            />
            <ListItemSecondaryAction sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<CopyIcon />}
                disabled={!logFileInfo}
                onClick={handleCopyLogPath}
              >
                复制路径
              </Button>
            </ListItemSecondaryAction>
          </ListItem>
          <Divider />
          {logFileInfo?.panic_log_exists && (
            <>
              <ListItem>
                <ListItemIcon>
                  <ErrorIcon color="error" />
                </ListItemIcon>
                <ListItemText
                  primary="上次崩溃日志"
                  secondary={logFileInfo.panic_log_path}
                  secondaryTypographyProps={{
                    component: 'code',
                    sx: { fontSize: '0.75rem', bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 1, display: 'inline-block', mt: 0.5, maxWidth: '100%', overflowWrap: 'anywhere' }
                  }}
                />
              </ListItem>
              <Divider />
            </>
          )}
          <ListItem>
            <ListItemText 
              primary="存储桶与对象缓存数据" 
              secondary="清除缓存的存储桶列表、已发现区域和已打开的对象视图，以强制从 S3 重新获取" 
            />
            <ListItemSecondaryAction>
              <Button 
                variant="outlined" 
                size="small" 
                startIcon={<ClearIcon />}
                onClick={handleClearCache}
              >
                清除缓存
              </Button>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      {/* Updates Section */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>更新</Typography>
        </Box>
        <List>
          <ListItem>
            <ListItemText 
              primary="检查更新" 
              secondary="手动检查是否有更新版本可用" 
            />
            <ListItemSecondaryAction>
              <Button 
                variant="contained" 
                size="small" 
                startIcon={<UpdateIcon />}
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
              >
                {isCheckingUpdate ? '检查中...' : '立即检查'}
              </Button>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
        <Alert severity="info" sx={{ m: 2, mt: 0 }}>
          Brows3 会在启动时自动检查更新。更新在安装前会进行签名校验。
        </Alert>
      </Paper>

      {/* System Monitor Section */}
      <SystemMonitor />
    </Container>
  );
}

function SystemMonitor() {
  const { logs, metrics, clearLogs } = useMonitorStore();
  
  return (
    <Paper variant="outlined">
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MonitorIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={600}>系统监控</Typography>
          </Box>
          <Button size="small" onClick={clearLogs} startIcon={<ClearIcon />}>清除日志</Button>
        </Box>
        
        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" color="primary">{metrics.totalRequests}</Typography>
                <Typography variant="caption" color="text.secondary">总请求数</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" color={metrics.failedRequests > 0 ? "error" : "text.secondary"}>
                    {metrics.failedRequests}
                </Typography>
                <Typography variant="caption" color="text.secondary">失败请求数</Typography>
            </Paper>
        </Box>

        <Box sx={{ maxHeight: 300, overflow: 'auto', borderTop: 1, borderColor: 'divider' }}>
            {logs.length === 0 ? (
                <Typography sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>暂无日志</Typography>
            ) : (
                <List dense>
                    {logs.map((log) => (
                        <ListItem key={log.id} divider>
                            <ListItemIcon sx={{ minWidth: 36 }}>
                                {log.type === 'error' ? <ErrorIcon color="error" fontSize="small" /> : 
                                 log.type === 'success' ? <SuccessIcon color="success" fontSize="small" /> :
                                 <InfoIcon color="info" fontSize="small" />}
                            </ListItemIcon>
                            <ListItemText 
                                primary={
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace' }}>{log.message}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </Typography>
                                    </Box>
                                }
                                secondary={log.details}
                                secondaryTypographyProps={{ 
                                    sx: { 
                                        color: 'error.main', 
                                        fontFamily: 'monospace', 
                                        fontSize: '0.75rem',
                                        mt: 0.5 
                                    } 
                                }}
                            />
                        </ListItem>
                    ))}
                </List>
            )}
        </Box>
    </Paper>
  );
}
