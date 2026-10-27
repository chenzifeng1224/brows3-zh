'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Button,
  TextField,
  Box,
  Typography,
  InputAdornment,
  Alert,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
  Stack,
  Chip,
} from '@mui/material';
import {
  Link as LinkIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  AccessTime as TimeIcon,
} from '@mui/icons-material';
import { BaseDialog } from '../common/BaseDialog';
import { copyToClipboard, objectApi } from '@/lib/tauri';

interface PresignedUrlDialogProps {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  bucketRegion: string | undefined;
  objectKey: string;
}

// Preset expiry options
const EXPIRY_OPTIONS = [
  { label: '15 分钟', value: 900 },
  { label: '1 小时', value: 3600 },
  { label: '6 小时', value: 21600 },
  { label: '12 小时', value: 43200 },
  { label: '24 小时', value: 86400 },
  { label: '7 天', value: 604800 },
  { label: '自定义', value: -1 },
];

export default function PresignedUrlDialog({
  open,
  onClose,
  bucketName,
  bucketRegion,
  objectKey,
}: PresignedUrlDialogProps) {
  const [selectedExpiry, setSelectedExpiry] = useState(3600);
  const [customExpiry, setCustomExpiry] = useState('');
  const [customUnit, setCustomUnit] = useState<'seconds' | 'minutes' | 'hours' | 'days'>('hours');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [generatedExpiry, setGeneratedExpiry] = useState<{ seconds: number; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const generateRequestIdRef = useRef(0);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Calculate actual expiry time in seconds
  const getExpirySeconds = (): number => {
    if (selectedExpiry !== -1) return selectedExpiry;
    
    const customValue = parseInt(customExpiry, 10) || 0;
    switch (customUnit) {
      case 'seconds': return customValue;
      case 'minutes': return customValue * 60;
      case 'hours': return customValue * 3600;
      case 'days': return customValue * 86400;
      default: return customValue;
    }
  };

  // Format expiry for display
  const formatExpiry = (seconds: number): string => {
    if (seconds < 60) return `${seconds} 秒`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时`;
    return `${Math.round(seconds / 86400)} 天`;
  };

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      generateRequestIdRef.current += 1;
      setSelectedExpiry(3600);
      setCustomExpiry('');
      setCustomUnit('hours');
      setGeneratedUrl(null);
      setGeneratedExpiry(null);
      setError(null);
      setCopied(false);
      setIsGenerating(false);
    }

    return () => {
      generateRequestIdRef.current += 1;
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = null;
      }
    };
  }, [open]);

  const handleGenerate = async () => {
    const expirySeconds = getExpirySeconds();
    
    if (expirySeconds <= 0) {
      setError('有效期必须大于 0');
      return;
    }
    
    // AWS max is 7 days (604800 seconds) for most credential types
    if (expirySeconds > 604800) {
      setError('对大多数 AWS 凭证类型，有效期不能超过 7 天（604800 秒）');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedUrl(null);
    const requestId = ++generateRequestIdRef.current;
    const requestedAt = Date.now();

    try {
      const url = await objectApi.getPresignedUrl(bucketName, bucketRegion, objectKey, expirySeconds);
      if (requestId === generateRequestIdRef.current) {
        setGeneratedUrl(url);
        setGeneratedExpiry({ seconds: expirySeconds, at: requestedAt + expirySeconds * 1000 });
      }
    } catch (err) {
      if (requestId === generateRequestIdRef.current) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(`生成 URL 失败：${errMsg}`);
      }
    } finally {
      if (requestId === generateRequestIdRef.current) {
        setIsGenerating(false);
      }
    }
  };

  const handleCopy = async () => {
    if (!generatedUrl) return;
    try {
      await copyToClipboard(generatedUrl);
      setCopied(true);
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copiedTimeoutRef.current = null;
      }, 2000);
    } catch {
      setError('复制到剪贴板失败');
    }
  };

  const fileName = objectKey.split('/').pop() || objectKey;

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="生成预签名 URL"
      maxWidth="sm"
      actions={
        <>
          <Button onClick={onClose}>关闭</Button>
          {!generatedUrl && (
            <Button
              onClick={handleGenerate}
              variant="contained"
              disabled={isGenerating || (selectedExpiry === -1 && !customExpiry)}
              startIcon={<LinkIcon />}
            >
              {isGenerating ? '生成中...' : '生成 URL'}
            </Button>
          )}
        </>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography variant="body2" color="text.secondary">
          生成一个临时 URL，任何持有该链接的人都可以访问{' '}
          <Box component="span" sx={{ fontWeight: 700, fontFamily: 'monospace', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 }}>
            {fileName}
          </Box>
        </Typography>

        {!generatedUrl ? (
          <>
            {/* Expiry Selection */}
            <FormControl fullWidth>
              <InputLabel id="expiry-label">URL 有效期</InputLabel>
              <Select
                labelId="expiry-label"
                value={selectedExpiry}
                label="URL 有效期"
                onChange={(e) => setSelectedExpiry(e.target.value as number)}
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Custom Expiry Input */}
            {selectedExpiry === -1 && (
              <Stack direction="row" spacing={2}>
                <TextField
                  label="自定义时长"
                  type="number"
                  value={customExpiry}
                  onChange={(e) => setCustomExpiry(e.target.value)}
                  sx={{ flex: 2 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <TimeIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  }}
                />
                <FormControl sx={{ flex: 1 }}>
                  <InputLabel>单位</InputLabel>
                  <Select
                    value={customUnit}
                    label="单位"
                    onChange={(e) => setCustomUnit(e.target.value as typeof customUnit)}
                  >
                    <MenuItem value="seconds">秒</MenuItem>
                    <MenuItem value="minutes">分钟</MenuItem>
                    <MenuItem value="hours">小时</MenuItem>
                    <MenuItem value="days">天</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            )}

            <Alert severity="info" sx={{ py: 0.5 }}>
              <Typography variant="caption">
                对大多数 AWS 凭证类型，预签名 URL 的最长有效期为 7 天。
                使用临时凭证（STS）生成的 URL 有效期可能更短。
              </Typography>
            </Alert>
          </>
        ) : (
          <>
            {/* Generated URL Display */}
            <Box sx={{ position: 'relative' }}>
              <TextField
                fullWidth
                multiline
                rows={4}
                value={generatedUrl}
                InputProps={{
                  readOnly: true,
                  sx: {
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    wordBreak: 'break-all',
                  },
                }}
              />
              <Tooltip title={copied ? '已复制！' : '复制 URL'}>
                <IconButton
                  onClick={handleCopy}
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    bgcolor: 'background.paper',
                  }}
                  color={copied ? 'success' : 'default'}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </IconButton>
              </Tooltip>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                icon={<TimeIcon />}
                label={`请求的有效期：${formatExpiry(generatedExpiry?.seconds || 0)}`}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  setGeneratedUrl(null);
                  setError(null);
                }}
              >
                再生成一个
              </Button>
            </Stack>

            {generatedExpiry && <Typography variant="caption" color="text.secondary">请求的过期时间：{new Date(generatedExpiry.at).toLocaleString()}。临时凭证可能更早过期。</Typography>}

            <Alert severity="warning" sx={{ py: 0.5 }}>
              <Typography variant="caption">
                任何拿到此 URL 的人都能在过期前访问该对象，请谨慎分享。
              </Typography>
            </Alert>
          </>
        )}

        {error && (
          <Alert severity="error" sx={{ py: 0.5 }}>
            {error}
          </Alert>
        )}
      </Box>
    </BaseDialog>
  );
}
