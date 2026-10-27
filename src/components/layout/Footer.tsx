'use client';

import { formatTransferSpeed, totalTransferSpeed } from '@/lib/transferSpeed';

import { Box, Typography, Divider, Tooltip } from '@mui/material';
import { 
    CloudDone as CloudDoneIcon, 
    SwapVert as TransferIcon,
    Dns as ProfileIcon,
    Public as RegionIcon,
    Cached as CachedIcon,
    Info as InfoIcon,
} from '@mui/icons-material';
import { useProfileStore } from '@/store/profileStore';
import { useTransferStore } from '@/store/transferStore';
import { useAppStore } from '@/store/appStore';
import { useBuckets } from '@/hooks/useBuckets';
import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@/lib/tauri';

function formatCacheAge(ms: number | null): string {
  if (ms === null) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时前`;
}

export default function Footer() {
  const { profiles, activeProfileId } = useProfileStore();
  const { jobs } = useTransferStore();
  const { discoveredRegions } = useAppStore();
  const { buckets, isCached, cacheAge, isLoading } = useBuckets({ enabled: !!activeProfileId });
  const searchParams = useSearchParams();
  const [appVersion, setAppVersion] = useState(() => (isTauri() ? '' : 'web'));
  
  // Fetch app version from Tauri
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    getVersion().then(v => setAppVersion(v)).catch(() => setAppVersion('dev'));
  }, []);
  
  const bucketName = searchParams.get('name');
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeTransfers = jobs.filter(j => j.status === 'Pending' || j.status === 'InProgress');

  // Priority: 1. Discovered region (specific to this bucket), 2. Profile default region
  const displayRegion = useMemo(() => {
    if (bucketName && discoveredRegions[bucketName]) {
      return discoveredRegions[bucketName];
    }
    return activeProfile?.region || 'N/A';
  }, [bucketName, discoveredRegions, activeProfile]);

  const isDiscovered = bucketName && discoveredRegions[bucketName] && discoveredRegions[bucketName] !== activeProfile?.region;
  
  const cacheStatus = useMemo(() => {
    if (isLoading) return { label: '加载中...', color: 'default' as const };
    if (isCached) return { label: `已缓存 ${formatCacheAge(cacheAge)}`, color: 'success' as const };
    return { label: '● 实时', color: 'primary' as const };
  }, [isCached, cacheAge, isLoading]);
  
  return (
    <Box
      component="footer"
      sx={{
        height: 28,
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        px: 2,
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.drawer + 1,
        gap: 2,
      }}
    >
      {/* Profile & Region Info */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
        <ProfileIcon sx={{ fontSize: 14 }} />
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {activeProfile?.name || '无配置'}
        </Typography>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />
        <Tooltip title={isDiscovered ? `为 ${bucketName} 自动识别` : '区域'}>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
             <RegionIcon sx={{ fontSize: 14, color: isDiscovered ? 'primary.main' : 'inherit' }} />
             <Typography variant="caption" sx={{ fontWeight: isDiscovered ? 700 : 400 }}>
               {displayRegion}
             </Typography>
           </Box>
        </Tooltip>
      </Box>

      <Box sx={{ flexGrow: 1 }} />

      {/* Cost Awareness Notice */}
      {activeProfile && (
        <Tooltip title="调用 S3 API 会产生费用。应用内上传/删除后缓存会自动刷新。">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.disabled', cursor: 'help' }}>
            <InfoIcon sx={{ fontSize: 12 }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
              会产生API费用
            </Typography>
          </Box>
        </Tooltip>
      )}

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />

      {/* Cache Status */}
      {activeProfile && (
        <Tooltip title="存储桶列表已缓存以减少 API 调用。点击刷新以更新。">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: isCached ? 'success.main' : 'primary.main' }}>
            <CachedIcon sx={{ fontSize: 12 }} />
            <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
              {cacheStatus.label}
            </Typography>
          </Box>
        </Tooltip>
      )}

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />

      {/* Stats Summary */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'text.secondary' }}>
        <Tooltip title={`找到 ${buckets.length} 个存储桶`}>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
             <CloudDoneIcon sx={{ fontSize: 14, color: activeProfile ? 'success.main' : 'inherit' }} />
             <Typography variant="caption">{buckets.length}</Typography>
           </Box>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />

        <Tooltip title={`${activeTransfers.length} 个进行中传输`}>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
             <TransferIcon sx={{ fontSize: 13, color: activeTransfers.length > 0 ? 'primary.main' : 'inherit' }} />
             <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>{activeTransfers.length}</Typography>
             {activeTransfers.length > 0 && <Typography variant="caption" sx={{ fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', display: { xs: 'none', lg: 'block' } }}>{(['Upload', 'Download'] as const).filter(type => activeTransfers.some(job => job.transfer_type === type)).map(type => `${type === 'Upload' ? '上传' : '下载'}: ${formatTransferSpeed(totalTransferSpeed(activeTransfers, type))}`).join(' · ')}</Typography>}
           </Box>
        </Tooltip>
      </Box>

      {/* Production Version */}
      <Typography variant="caption" sx={{ color: 'text.disabled', ml: 1, fontSize: '0.65rem' }}>
        Brows3 v{appVersion || '...'}
      </Typography>
    </Box>
  );
}
