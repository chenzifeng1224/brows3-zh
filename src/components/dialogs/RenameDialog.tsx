import { useEffect, useState } from 'react';
import {
  Button,
  TextField,
  Box,
  Typography,
  InputAdornment,
  Alert,
} from '@mui/material';
import { DriveFileRenameOutline as RenameIcon } from '@mui/icons-material';
import { BaseDialog } from '../common/BaseDialog';

interface RenameDialogProps {
  open: boolean;
  onClose: () => void;
  onRename: (newName: string) => Promise<void>;
  currentName: string;
  isFolder?: boolean;
}

export default function RenameDialog({ open, onClose, onRename, currentName, isFolder = false }: RenameDialogProps) {
  const [value, setValue] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(currentName);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open, currentName]);

  const handleSubmit = async () => {
    if (!value.trim() || value === currentName) return;
    
    setIsSubmitting(true);
    setError(null);
    try {
      await onRename(value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseDialog 
      open={open} 
      onClose={onClose} 
      title="重命名对象"
      maxWidth="sm"
      actions={
        <>
          <Button 
            onClick={onClose} 
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button 
            onClick={handleSubmit} 
            variant="contained" 
            disabled={!value.trim() || value === currentName || isSubmitting}
          >
            {isSubmitting ? '重命名中...' : '重命名'}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
            为 <strong>{currentName}</strong> 输入新名称。
            <Box component="span" sx={{ display: 'block', mt: 0.5, fontSize: '0.8rem', opacity: 0.8 }}>
              注意：这会将对象复制到新键并删除旧键。
            </Box>
            {isFolder && (
              <Alert severity="warning" sx={{ mt: 1.5, py: 0, '& .MuiAlert-message': { fontSize: '0.8rem' } }}>
                警告：重命名文件夹会移动其中的所有对象。对于较大的文件夹，这可能需要很长时间。
              </Alert>
            )}
        </Typography>
        
        <TextField
            autoFocus
            fullWidth
            label="新名称"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            error={!!error}
            helperText={error}
            disabled={isSubmitting}
            InputProps={{
                startAdornment: (
                    <InputAdornment position="start">
                        <RenameIcon fontSize="small" color="action" />
                    </InputAdornment>
                )
            }}
        />
      </Box>
    </BaseDialog>
  );
}
