import {
  Typography,
  Box,
  Link,
  Chip,
  Divider,
  alpha,
  useTheme,
} from '@mui/material';
import { GitHub as GitHubIcon } from '@mui/icons-material';
import Image from 'next/image';
import { getVersion } from '@tauri-apps/api/app';
import { useState, useEffect } from 'react';
import { BaseDialog } from '../common/BaseDialog';
import { isTauri } from '@/lib/tauri';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const [version, setVersion] = useState<string>(() => (isTauri() ? '...' : 'Web'));
  const theme = useTheme();

  useEffect(() => {
    if (!open || !isTauri()) {
      return;
    }

    getVersion().then(setVersion).catch(() => setVersion('未知'));
  }, [open]);

  return (
    <BaseDialog 
      open={open} 
      onClose={onClose} 
      title="关于 Brows3"
      maxWidth="xs"
    >
      <Box sx={{ textAlign: 'center', pb: 2 }}>
        {/* Logo with slight pulse or refined container */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <Box
            sx={{
              width: 90,
              height: 90,
              borderRadius: 3,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 12px 32px ${alpha(theme.palette.primary.main, 0.2)}`,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.5)
            }}
          >
            <Image src="/logo.png" alt="Brows3" width={72} height={72} style={{ objectFit: 'contain' }} />
          </Box>
        </Box>
        
        <Typography variant="h3" sx={{ fontSize: '1.5rem', mb: 0.5 }}>Brows3</Typography>
        
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 3 }}>
          <Chip 
            label={`版本 ${version}`} 
            size="small" 
            sx={{ 
              fontWeight: 800, 
              fontSize: '0.7rem',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
              border: 'none'
            }}
          />
          <Chip 
            label="公开测试版" 
            size="small" 
            sx={{ 
              fontWeight: 800, 
              fontSize: '0.7rem',
              bgcolor: alpha(theme.palette.secondary.main, 0.1),
              color: theme.palette.secondary.main,
              border: 'none'
            }}
          />
        </Box>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4, lineHeight: 1.7, fontWeight: 500 }}>
          高性能、开源的 Amazon S3 桌面客户端。
          为速度、安全和优质的开发者体验而打造。
        </Typography>
        
        <Divider sx={{ mb: 4, bgcolor: alpha(theme.palette.divider, 0.5) }} />
        
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Link 
            href="https://github.com/rgcsekaraa/brows3" 
            target="_blank" 
            rel="noopener"
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: 1.5,
              fontWeight: 700,
              color: theme.palette.text.primary,
              textDecoration: 'none',
              '&:hover': { color: theme.palette.primary.main }
            }}
          >
            <GitHubIcon fontSize="small" />
            查看源代码
          </Link>
          <Link 
            href="https://github.com/rgcsekaraa/brows3/issues" 
            target="_blank" 
            rel="noopener"
            color="text.secondary"
            sx={{ fontSize: '0.85rem', fontWeight: 600 }}
          >
            报告问题或请求新功能
          </Link>
        </Box>
        
        <Box sx={{ mt: 5 }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600, letterSpacing: '0.05em' }}>
            TAURI • REACT • RUST • NEXT.JS
          </Typography>
          <Typography variant="caption" display="block" color="text.disabled" sx={{ mt: 1, opacity: 0.5 }}>
            基于 MIT 许可证发布 © 2026
          </Typography>
        </Box>
      </Box>
    </BaseDialog>
  );
}
