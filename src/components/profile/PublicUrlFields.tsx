'use client';
import { Accordion, AccordionSummary, AccordionDetails, Box, Button, Checkbox, FormControlLabel, IconButton, TextField, Typography } from '@mui/material';
import { ExpandMore, Close } from '@mui/icons-material';
import { PublicUrlSettings } from '@/lib/tauri';
import { validateHttpUrl } from '@/lib/urlImport';
import { urlActionStyles } from '@/components/common/urlActionStyles';

export interface PublicUrlForm { base: string; includeBucket: boolean; overrides: { bucket: string; url: string }[] }
export const emptyPublicUrlForm = (): PublicUrlForm => ({ base: '', includeBucket: false, overrides: [] });
export function publicUrlSettings(form: PublicUrlForm): PublicUrlSettings {
  const validate = (value: string) => {
    const error = validateHttpUrl(value); if (error) throw new Error(error);
    if (new URL(value).search) throw new Error('公共基础 URL 不能包含查询参数，请将签名链接单独保存。');
  };
  const base = form.base.trim(); if (base) validate(base);
  const overrides: Record<string, string> = Object.create(null);
  for (const row of form.overrides) {
    const bucket = row.bucket.trim(), url = row.url.trim();
    if (!bucket || bucket.includes('/') || Object.hasOwn(overrides, bucket)) throw new Error('每条公共 URL 覆盖项都需要唯一的存储桶名称。');
    validate(url); overrides[bucket] = url;
  }
  return { base_url: base, include_bucket: form.includeBucket, bucket_overrides: overrides };
}
export default function PublicUrlFields({ value, onChange }: { value: PublicUrlForm; onChange: (value: PublicUrlForm) => void }) {
  return <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
    <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2" fontWeight={600}>公共 URL 与 CDN（可选）</Typography></AccordionSummary>
    <AccordionDetails sx={{ px: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">仅在复制公共链接时使用。这不会公开文件，也不会更改 S3 权限。留空则使用 S3 端点。</Typography>
        <TextField size="small" fullWidth label="公共 / CDN 基础 URL" placeholder="https://cdn.example.com/assets" value={value.base} onChange={e => onChange({ ...value, base: e.target.value })} />
        <FormControlLabel control={<Checkbox size="small" checked={value.includeBucket} onChange={(_, checked) => onChange({ ...value, includeBucket: checked })} />} label="在文件路径前附加存储桶名称" />
        <Typography variant="body2">存储桶覆盖项直接指向该存储桶的公共根路径。</Typography>
        {value.overrides.map((row, index) => <Box key={index} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <TextField size="small" label={`存储桶 ${index + 1}`} value={row.bucket} sx={{ flex: '1 1 140px' }} onChange={e => onChange({ ...value, overrides: value.overrides.map((v, i) => i === index ? { ...v, bucket: e.target.value } : v) })} />
          <TextField size="small" label={`公共根路径 ${index + 1}`} value={row.url} sx={{ flex: '2 1 230px' }} onChange={e => onChange({ ...value, overrides: value.overrides.map((v, i) => i === index ? { ...v, url: e.target.value } : v) })} />
          <IconButton size="small" aria-label={`移除存储桶覆盖项 ${index + 1}`} onClick={() => onChange({ ...value, overrides: value.overrides.filter((_, i) => i !== index) })}><Close fontSize="small" /></IconButton>
        </Box>)}
        <Button size="small" sx={[urlActionStyles, { alignSelf: 'flex-start' }]} disabled={value.overrides.length >= 100} onClick={() => onChange({ ...value, overrides: [...value.overrides, { bucket: '', url: '' }] })}>添加存储桶覆盖项</Button>
      </Box>
    </AccordionDetails>
  </Accordion>;
}
