'use client';

import { Suspense, useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  IconButton,
  Link,
  Typography,
  CircularProgress,
  Alert,
  Menu,
  MenuItem,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Tooltip,
  Divider,
  InputAdornment,
  Fade,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Refresh as RefreshIcon,
  Home as HomeIcon,
  CloudUpload as CloudUploadIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  DriveFileRenameOutline as RenameIcon,
  Info as InfoIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Storage as StorageIcon,
  FileCopy as FileCopyIcon,
  FilePresent as FilePresentIcon,
  Link as LinkIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  FolderZip as FolderZipIcon,
  ArrowDropDown as ArrowDropDownIcon,
  Edit as EditIcon,
  Lock as LockIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { useObjects } from '@/hooks/useObjects';
import { operationsApi, transferApi, objectApi, S3Object, copyToClipboard } from '@/lib/tauri';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useTransferStore } from '@/store/transferStore';
import { useClipboardStore } from '@/store/clipboardStore';
import { useProfileStore } from '@/store/profileStore';
import PropertiesDialog from '@/components/dialogs/PropertiesDialog';
import FolderSyncDialog from '@/components/dialogs/FolderSyncDialog';
import CrossProfileCopyDialog from '@/components/dialogs/CrossProfileCopyDialog';
import VersionHistoryDialog from '@/components/dialogs/VersionHistoryDialog';
import type { ClipboardItem } from '@/store/clipboardStore';
import PermissionsDialog from '@/components/dialogs/PermissionsDialog';
import ObjectPreviewDialog from '@/components/dialogs/ObjectPreviewDialog';
import { canObjectBeEdited, getObjectName } from '@/lib/objectCapabilities';
import { usePreviewNavigation } from '@/hooks/usePreviewNavigation';
import PresignedUrlDialog from '@/components/dialogs/PresignedUrlDialog';
import PublicUrlsDialog from '@/components/dialogs/PublicUrlsDialog';
import UrlImportDialog from '@/components/dialogs/UrlImportDialog';
import { VirtualizedObjectTable } from '@/components/common/VirtualizedObjectTable';
import { toast } from '@/store/toastStore';
import { useHistoryStore } from '@/store/historyStore';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StyledCheckbox } from '@/components/common/StyledCheckbox';

// Concurrent paste batch size
const PASTE_CONCURRENCY = 5;

const joinLocalPath = (basePath: string, leafName: string): string => {
  const normalizedBase = basePath.replace(/[\\/]+$/, '');
  const normalizedLeaf = leafName.replace(/^[\\/]+/, '');
  const separator = normalizedBase.includes('\\') && !normalizedBase.includes('/') ? '\\' : '/';
  return `${normalizedBase}${separator}${normalizedLeaf}`;
};

function BucketContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const bucketName = searchParams.get('name');
  const bucketRegion = searchParams.get('region') || 'us-east-1';
  const prefix = searchParams.get('prefix') || '';

  // Sorting State
  const [sortField, setSortField] = useState<'name' | 'size' | 'date' | 'class'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const { data, isLoading, error: initialError, refresh, loadMore, hasMore, isLoadingMore } = useObjects(bucketName || '', bucketRegion, prefix, sortField, sortDirection);
  const addJob = useTransferStore(state => state.addJob);
  const activeProfileId = useProfileStore(state => state.activeProfileId);
  const viewKey = JSON.stringify([activeProfileId, bucketName, bucketRegion, prefix]);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isDeepSearch, setIsDeepSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<{ viewKey: string; objects: S3Object[] } | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Error handling effect
  useEffect(() => {
    if (initialError) {
      toast.error(typeof initialError === 'string' ? initialError : '对象加载失败');
    }
  }, [initialError]);

  // Track previous job statuses to detect completions
  // We use a ref to track status without causing re-renders
  const prevJobStatusRef = useRef<Map<string, string>>(new Map());

  // Refresh debounce ref
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchSequenceRef = useRef<number>(0);

  // Auto-refresh when uploads to this bucket complete
  // OPTIMIZED: Use subscription to avoid re-rendering component on every progress tick
  useEffect(() => {
    if (!bucketName) return;

    // Initialize ref with current state without causing render
    const currentJobs = useTransferStore.getState().jobs;
    const initialMap = new Map<string, string>();
    for (const job of currentJobs) {
        if (job.transfer_type === 'Upload' && job.bucket === bucketName) {
            initialMap.set(job.id, typeof job.status === 'string' ? job.status : 'Failed');
        }
    }
    prevJobStatusRef.current = initialMap;

    const unsubscribe = useTransferStore.subscribe((state) => {
        const jobs = state.jobs;
        let shouldRefresh = false;
        const currentStatuses = new Map<string, string>();

        for (const job of jobs) {
            // Only care about uploads to this bucket
            if (job.transfer_type !== 'Upload' || job.bucket !== bucketName) continue;

            const prevStatus = prevJobStatusRef.current.get(job.id);
            const currentStatus = typeof job.status === 'string' ? job.status : 'Failed';

            // Store current status for next comparison
            currentStatuses.set(job.id, currentStatus);

            // If job just completed (was something else before, now Completed)
            if (prevStatus && prevStatus !== 'Completed' && currentStatus === 'Completed') {
                shouldRefresh = true;
            }
        }

        // Update ref
        prevJobStatusRef.current = currentStatuses;

        if (shouldRefresh) {
            // Debounce refresh (2 seconds)
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
            refreshTimeoutRef.current = setTimeout(() => {
                refresh();
                refreshTimeoutRef.current = null;
            }, 2000);
        }
    });

    return () => {
        unsubscribe();
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
        }
    };
  }, [bucketName, refresh]);

  const handleSearch = async () => {
    if (!bucketName) return;
    const query = searchQuery.trim();

    // If empty query, clear everything
    if (!query) {
        searchSequenceRef.current += 1;
        setSearchResults(null);
        setIsSearching(false);
        return;
    }

    if (isDeepSearch) {
        setIsSearching(true);
        const currentSequence = ++searchSequenceRef.current;

        try {
            // Server-side deep search with timeout to prevent freeze
            const SEARCH_TIMEOUT_MS = 30000; // 30 seconds max

            const searchPromise = objectApi.searchObjects(bucketName, bucketRegion, query, prefix);
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Search timed out after 30 seconds')), SEARCH_TIMEOUT_MS)
            );

            const result = await Promise.race([searchPromise, timeoutPromise]);

            // CRITICAL FIX: Only update if this is still the latest search request
            if (currentSequence === searchSequenceRef.current) {
                setSearchResults({ viewKey, objects: result.objects });

                if (result.is_truncated) {
                    toast.info(
                        '达到搜索上限',
                        `已扫描 ${result.scanned_objects.toLocaleString()} 个对象，返回 ${result.objects.length.toLocaleString()} 条匹配结果。请缩小前缀或查询范围后继续。`
                    );
                } else if (result.objects.length === 0) {
                    toast.info('无结果', `未找到匹配 "${query}" 的对象`);
                }
            }
        } catch (err) {
            if (currentSequence === searchSequenceRef.current) {
                const errMsg = err instanceof Error ? err.message : String(err);
                displayError('搜索失败', errMsg);
                setSearchResults(null);
            }
        } finally {
            if (currentSequence === searchSequenceRef.current) {
                setIsSearching(false);
            }
        }
    } else {
        // Local search is handled by useMemo (displayData), so we just clear server results
        setSearchResults(null);
    }
  };

  // Auto-trigger search when toggling deep search if query exists
  useEffect(() => {
      if (searchQuery.trim()) {
        handleSearch();
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when isDeepSearch toggles
  }, [isDeepSearch]);

  // derived data for display (sorting handled by VirtualizedObjectTable)
  const displayData = useMemo(() => {
     const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

     // 1. Deep Search Results (Server-side)
     if (isDeepSearch && searchResults?.viewKey === viewKey) {
         return {
             common_prefixes: [],
             objects: searchResults.objects,
             next_continuation_token: null,
             is_truncated: false,
             prefix: prefix,
         };
     }

     // 2. Local Filtering (Client-side on current page data)
     if (!isDeepSearch && normalizedQuery && data) {
         return {
             ...data,
             objects: data.objects.filter(o => o.key.toLowerCase().includes(normalizedQuery)),
             common_prefixes: data.common_prefixes.filter(p => p.toLowerCase().includes(normalizedQuery))
         };
     }

     // 3. Default View
     return data;
  }, [data, searchResults, deferredSearchQuery, prefix, isDeepSearch, viewKey]);

  const currentObjectSizeMap = useMemo(
    () => new Map([...(data?.objects || []), ...(displayData?.objects || [])].map((obj) => [obj.key, obj.size])),
    [data, displayData]
  );
  const currentFolderKeys = useMemo(
    () => new Set(data?.common_prefixes || []),
    [data]
  );

  const [isUploading, setIsUploading] = useState(false);
  const [uploadMenuAnchor, setUploadMenuAnchor] = useState<null | HTMLElement>(null);
  const [urlImportScope, setUrlImportScope] = useState<string | null>(null);
  const [publicLinks, setPublicLinks] = useState<{ scope: string; keys: string[] } | null>(null);
  useEffect(() => { setUrlImportScope(null); setPublicLinks(null); }, [viewKey]);
  const [syncDestination, setSyncDestination] = useState<string | null>(null);
  const [versionHistory, setVersionHistory] = useState<{ viewKey: string; key: string } | null>(null);
  useEffect(() => { setVersionHistory(null); }, [viewKey]);
  const [crossCopy, setCrossCopy] = useState<{ viewKey: string; items: ClipboardItem[] } | null>(null);
  useEffect(() => { setCrossCopy(null); }, [viewKey]);
  useEffect(() => { setSyncDestination(null); }, [viewKey]);

  // Create Folder State
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Context Menu State
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedObject, setSelectedObject] = useState<{key: string, isFolder: boolean} | null>(null);

  // Properties State
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [selectedObjectProp, setSelectedObjectProp] = useState<string | null>(null);

  // Permissions State
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [selectedObjectPermissions, setSelectedObjectPermissions] = useState<{ key: string; isFolder: boolean } | null>(null);

  // Preview/Edit Dialog State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<number | undefined>(undefined);
  const [startInEditMode, setStartInEditMode] = useState(false);
  const [previewScope, setPreviewScope] = useState('');

  const previewNavigation = usePreviewNavigation({
    objects: displayData?.objects || [], field: sortField, direction: sortDirection,
    context: JSON.stringify([viewKey, sortField, sortDirection, deferredSearchQuery, isDeepSearch]),
    objectKey: previewKey, open: previewOpen && previewScope === viewKey,
    hasMore: !isDeepSearch && hasMore, query: isDeepSearch ? '' : deferredSearchQuery.trim(), loadMore,
    onNavigate: object => { setPreviewKey(object.key); setPreviewSize(object.size); setStartInEditMode(false); },
  });

  // Presigned URL Dialog State
  const [presignedUrlOpen, setPresignedUrlOpen] = useState(false);
  const [presignedUrlKey, setPresignedUrlKey] = useState<string | null>(null);

  const handlePropertiesOpen = () => {
    handleMenuClose();
    if (selectedObject) {
       setSelectedObjectProp(selectedObject.key);
       setPropertiesOpen(true);
    }
  };

  const handlePermissionsOpen = () => {
    handleMenuClose();
    if (selectedObject) {
      setSelectedObjectPermissions(selectedObject);
      setPermissionsOpen(true);
    }
  };

  // Delete Check State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const displayError = useCallback((msg: string, details?: string) => {
    toast.error(msg, details);
  }, []);

  // Helper for success toast with optional navigation
  const displaySuccess = useCallback((msg: string, path?: string) => {
    toast.success(msg, undefined, path ? {
        label: '查看',
        onClick: () => {
            // Add tab first if needed, but simple push works as tab store will auto-detect path if configured
            // Or just router.push
            router.push(path);
        }
    } : undefined);
  }, [router]);

  const breadcrumbs = useMemo(() => {
    const parts = prefix.split('/').filter(Boolean);
    let path = '';
    return parts.map((part) => {
      path += part + '/';
      return { name: part, path: path };
    });
  }, [prefix]);

  const { addRecent, addFavorite, removeFavorite, isFavorite } = useHistoryStore();

  const bucketIsFavorite = !!bucketName && !!activeProfileId && isFavorite('', bucketName, activeProfileId);

  const handleToggleBucketFavorite = () => {
    if (!bucketName || !activeProfileId) return;
    if (isFavorite('', bucketName, activeProfileId)) {
      removeFavorite('', bucketName, activeProfileId);
      displaySuccess('已从收藏移除存储桶');
      return;
    }
    addFavorite({
      key: '',
      name: bucketName,
      bucket: bucketName,
      region: bucketRegion,
      profileId: activeProfileId,
      isFolder: true,
    });
    displaySuccess('已将存储桶根加入收藏');
  };

  const handleNavigate = (newPrefix: string) => {
    // Track in recent history
    if (newPrefix && bucketName) {
      const name = newPrefix.split('/').filter(Boolean).pop() || newPrefix;
      addRecent({
        key: newPrefix,
        name,
        bucket: bucketName,
        region: bucketRegion,
        profileId: activeProfileId || undefined,
        isFolder: true,
      });
    }

    const params = new URLSearchParams();
    if (bucketName) params.set('name', bucketName);
    if (bucketRegion) params.set('region', bucketRegion);
    if (newPrefix) params.set('prefix', newPrefix);
    router.push(`/bucket?${params.toString()}`);
  };

  const handleBack = () => {
    if (!prefix) {
      router.push('/');
      return;
    }
    const parts = prefix.split('/').filter(Boolean);
    parts.pop();
    const newPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    handleNavigate(newPrefix);
  };

  // --- ACTIONS ---

  // Multi-select State
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Clear selection when navigating to a different folder
  useEffect(() => {
    setSelectedKeys(new Set());
    setSelectedObject(null);
    setPreviewOpen(false);
    setPropertiesOpen(false);
    setPermissionsOpen(false);
    setPresignedUrlOpen(false);
    setDeleteConfirmOpen(false);
  }, [viewKey]);

  // Selection Handlers - memoized to prevent re-renders
  const handleSelect = useCallback((key: string, checked: boolean) => {
    setSelectedKeys(prev => {
      const newSelected = new Set(prev);
      if (checked) newSelected.add(key);
      else newSelected.delete(key);
      return newSelected;
    });
  }, []);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (!displayData) {
      return;
    }

    const visibleKeys = [
      ...displayData.common_prefixes,
      ...displayData.objects.map((o) => o.key),
    ];

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        visibleKeys.forEach((key) => next.add(key));
      } else {
        visibleKeys.forEach((key) => next.delete(key));
      }
      return next;
    });
  }, [displayData]);

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  // Clipboard State
  const { items: clipboardItems, mode: clipboardMode, copy, cut, clear: clearClipboard } = useClipboardStore();

  // Memoized clipboard handlers using refs to access latest state
  const selectedKeysRef = useRef(selectedKeys);
  selectedKeysRef.current = selectedKeys;

  const handleCopy = useCallback(() => {
     const keys = selectedKeysRef.current;
     if (keys.size === 0) return;
     const items = Array.from(keys).map(key => ({
       profileId: activeProfileId || '',
       bucket: bucketName || '',
       region: bucketRegion,
       key,
       isFolder: key.endsWith('/')
     }));
     copy(items);
     clearSelection();
     displaySuccess(`已复制 ${items.length} 个项目`);
  }, [activeProfileId, bucketName, bucketRegion, copy, clearSelection, displaySuccess]);

  const handleCut = useCallback(() => {
    const keys = selectedKeysRef.current;
    if (keys.size === 0) return;
    const items = Array.from(keys).map(key => ({
      profileId: activeProfileId || '',
      bucket: bucketName || '',
      region: bucketRegion,
      key,
      isFolder: key.endsWith('/')
    }));
    cut(items);
    clearSelection();
    displaySuccess(`已剪切 ${items.length} 个项目到剪贴板`);
  }, [activeProfileId, bucketName, bucketRegion, cut, clearSelection, displaySuccess]);

  const handlePaste = async () => {
    if (!bucketName || clipboardItems.length === 0) return;
    if (!activeProfileId || clipboardItems.some(item => item.profileId !== activeProfileId)) {
      if (activeProfileId && clipboardMode === 'copy' && clipboardItems.every(item => !!item.profileId && item.profileId === clipboardItems[0].profileId && item.profileId !== activeProfileId)) {
        setCrossCopy({ viewKey, items: [...clipboardItems] });
        return;
      }
      clearClipboard();
      displayError('剪贴板内容属于其他配置，请重新复制所选项目。');
      return;
    }
    let successCount = 0;

    // Process paste operations in parallel batches for better performance
    const items = [...clipboardItems];

    try {
      for (let i = 0; i < items.length; i += PASTE_CONCURRENCY) {
        const batch = items.slice(i, i + PASTE_CONCURRENCY);

        await Promise.all(batch.map(async (item) => {
          const fileName = item.key.split('/').filter(Boolean).pop();
          let destKey = prefix + fileName + (item.isFolder ? '/' : '');

          // Check for same location paste
          if (item.bucket === bucketName && item.region === bucketRegion && destKey === item.key) {
             // Auto-rename
             const namePart = fileName?.split('.').slice(0, -1).join('.') || fileName;
             const extPart = (fileName?.split('.').length ?? 0) > 1 ? '.' + fileName?.split('.').pop() : '';
             destKey = prefix + namePart + `-${Date.now()}` + extPart + (item.isFolder ? '/' : '');
          }

          if (clipboardMode === 'copy') {
            await operationsApi.copyObject(item.bucket, item.region, item.key, bucketName, bucketRegion, destKey, item.profileId);
          } else {
            await operationsApi.moveObject(item.bucket, item.region, item.key, bucketName, bucketRegion, destKey, item.profileId);
          }
          successCount++;
        }));
      }
      displaySuccess(`已粘贴 ${successCount} 个项目`);
      if (clipboardMode === 'move') clearClipboard();
      refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      displayError(`粘贴失败：${errorMsg}`);
    }
  };

  // Actions

  // Store refs to handlers for keyboard listener
  const handleCopyRef = useRef(handleCopy);
  const handleCutRef = useRef(handleCut);
  const handlePasteRef = useRef(handlePaste);

  useEffect(() => {
    handleCopyRef.current = handleCopy;
    handleCutRef.current = handleCut;
    handlePasteRef.current = handlePaste;
  });

  // Keyboard Shortcuts - use refs to always get latest function
  useEffect(() => {
    searchSequenceRef.current += 1;
    setSearchResults(null);
    setIsSearching(false);
    return () => { searchSequenceRef.current += 1; };
  }, [searchQuery, viewKey]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target instanceof HTMLInputElement && target.type === 'checkbox') return false;
      const tagName = target.tagName;
      return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
    };

    const handleKeyDown = (e: KeyboardEvent) => {
       if (isEditableTarget(e.target)) {
         return;
       }

       // Copy: Cmd+C
       if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
         e.preventDefault();
         handleCopyRef.current();
       }
       // Cut: Cmd+X
       if ((e.metaKey || e.ctrlKey) && e.key === 'x') {
         e.preventDefault();
         handleCutRef.current();
       }
       // Paste: Cmd+V
       if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
         e.preventDefault();
         handlePasteRef.current();
       }
       // Delete: Delete key
       if (e.key === 'Delete' && selectedKeysRef.current.size > 0) {
         setDeleteConfirmOpen(true);
       }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // Empty deps - we use refs for latest values

  // Restored Actions
  const handleUploadFiles = async () => {
    setUploadMenuAnchor(null);
    if (!bucketName) return;
    try {
      const selected = await open({
        multiple: true,
        title: '选择要上传的文件'
      });

      if (selected) {
        setIsUploading(true);
        const files = Array.isArray(selected) ? selected : [selected];
        let count = 0;

        for (const file of files) {
           const filename = file.split(/[/\\]/).pop() || 'uploaded-file';
           const key = prefix + filename;

           const jobId = await transferApi.queueUpload(bucketName, bucketRegion, key, file, 0, activeProfileId);

           addJob({
              id: jobId,
              profile_id: activeProfileId || '',
              transfer_type: 'Upload',
              bucket: bucketName,
              bucket_region: bucketRegion,
              key: key,
              local_path: file,
              total_bytes: 0,
              processed_bytes: 0,
              status: 'Pending',
              created_at: Date.now()
           });
           count++;
        }
        displaySuccess(`已排队上传 ${count} 个文件`, '/uploads');
      }
    } catch (err) {
      displayError(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadFolder = async () => {
    setUploadMenuAnchor(null);
    if (!bucketName) return;
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: '选择要上传的文件夹'
      });

      if (selected) {
         setIsUploading(true);
         const folders = Array.isArray(selected) ? selected : [selected];
         let totalFiles = 0;

         for (const folder of folders) {
             const count = await transferApi.queueFolderUpload(bucketName, bucketRegion, prefix, folder, activeProfileId);
             totalFiles += count;
         }

         displaySuccess(`已从 ${folders.length} 个文件夹排队上传 ${totalFiles} 个文件`, '/uploads');
      }
    } catch (err) {
      displayError(`文件夹上传失败：${err}`);
    } finally {
        setIsUploading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!bucketName || !newFolderName.trim()) return;
    setIsCreatingFolder(true);
    try {
      const cleanName = newFolderName.trim().replace(/^\/+/, '').replace(/\/+$/, '');
      const key = prefix + cleanName + '/';

      await operationsApi.putObject(bucketName, bucketRegion, key);
      setCreateFolderOpen(false);
      setNewFolderName('');
      displaySuccess(`已创建文件夹 ${cleanName}`);
      refresh();
    } catch (err) {
      displayError(`创建文件夹失败：${err}`);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedKeys.size === 0) return;
    if (Array.from(selectedKeys).some(key => !currentFolderKeys.has(key) && !currentObjectSizeMap.has(key))) {
      displayError('所选项目已不可用，请重新选择。');
      return;
    }

    // Select directory for downloads
    const selected = await open({
        directory: true,
        multiple: false,
        title: '选择下载目录'
    });

    if (!selected) return;

    const downloadDir = Array.isArray(selected) ? selected[0] : selected;

    setIsUploading(true);
    let count = 0;

    // Convert to array for batching
    const keysArray = Array.from(selectedKeys);
    const BATCH_SIZE = 5;
    const BATCH_DELAY = 100; // ms between batches

    try {
      // Process in batches to prevent WebKit from crashing
      for (let i = 0; i < keysArray.length; i += BATCH_SIZE) {
        const batch = keysArray.slice(i, i + BATCH_SIZE);

        // Process batch items concurrently
        await Promise.all(batch.map(async (key) => {
          const selectedObjectSize = currentObjectSizeMap.get(key);
          const isSelectedFolder = currentFolderKeys.has(key);

          if (isSelectedFolder) {
            const folderName = key.split('/').filter(Boolean).pop() || 'folder';
            const localPath = joinLocalPath(downloadDir, folderName);
            await transferApi.queueFolderDownload(bucketName || '', bucketRegion, key, localPath, activeProfileId);
            count++;
          } else if (selectedObjectSize !== undefined) {
            const fileName = key.split('/').pop() || 'file';
            const localPath = joinLocalPath(downloadDir, fileName);
            await transferApi.queueDownload(bucketName || '', bucketRegion, key, localPath, selectedObjectSize, false, activeProfileId);
            count++;
          }
        }));

        // Small delay between batches to let WebKit breathe
        if (i + BATCH_SIZE < keysArray.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }

      displaySuccess(`已排队下载 ${count} 个项目。`, '/downloads');
      setSelectedKeys(new Set());
    } catch (err) {
      displayError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  };


  const handleBulkDelete = async () => {
    if (!bucketName || selectedKeys.size === 0) return;

    setIsDeleting(true);
    try {
        // Collect all keys to delete - for folders, we need to list ALL objects recursively
        const keysToDelete = new Set<string>();

        for (const key of selectedKeys) {
          if (key.endsWith('/')) {
            // It's a folder - list ALL objects recursively under this prefix
            // Must use: empty delimiter (to get all nested objects) AND bypassCache (to avoid cached folder structure)
            try {
              let continuationToken: string | undefined;
              const seenTokens = new Set<string>();
              let pages = 0;
              do {
                // Empty delimiter = flat list of ALL objects, bypassCache = true = skip folder-structured cache
                const result = await objectApi.listObjects(bucketName, bucketRegion, key, '', continuationToken, true, undefined, undefined, activeProfileId);
                if (useProfileStore.getState().activeProfileId !== activeProfileId) {
                  throw new Error('当前配置已变更，未删除任何内容。');
                }
                // Add all objects under this prefix (since delimiter is empty, no common_prefixes will be returned)
                for (const obj of result.objects) {
                  keysToDelete.add(obj.key);
                }
                continuationToken = result.next_continuation_token || undefined;
                if (++pages > 100 || keysToDelete.size > 100_000 || (result.is_truncated && !continuationToken) || (continuationToken && seenTokens.has(continuationToken))) {
                  throw new Error("文件夹列表不完整或超出安全上限，请选择更小的前缀。");
                }
                if (continuationToken) seenTokens.add(continuationToken);
              } while (continuationToken);
              // Also delete the folder marker itself
              keysToDelete.add(key);
            } catch (listErr) {
              console.error(`Failed to list folder contents: ${key}`, listErr);
              throw new Error(`无法列出 ${key} 中的所有对象，未删除任何内容。${listErr instanceof Error ? listErr.message : String(listErr)}`);
            }
          } else {
            // It's a file - just add it
            keysToDelete.add(key);
          }
        }

        if (keysToDelete.size === 0) {
          displaySuccess('没有可删除的项目');
          setDeleteConfirmOpen(false);
          return;
        }

        // Delete all collected keys
        const keysToDeleteList = Array.from(keysToDelete);
        if (useProfileStore.getState().activeProfileId !== activeProfileId) {
          throw new Error('当前配置已变更，未删除任何内容。');
        }
        await operationsApi.deleteObjects(bucketName, bucketRegion, keysToDeleteList, activeProfileId);
        displaySuccess(`已成功删除 ${keysToDeleteList.length} 个项目`);
        setSelectedKeys(new Set());
        refresh();
        setDeleteConfirmOpen(false);
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
        displayError(`批量删除失败：${errorMsg}`);
    } finally {
        setIsDeleting(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, key: string, isFolder: boolean) => {
    event.stopPropagation();
    setMenuAnchorEl(event.currentTarget);
    setSelectedObject({ key, isFolder });
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    setSelectedObject(null);
  };

  // Existing single actions
  const handleDownload = async () => {
    if (!bucketName || !selectedObject) return;
    const target = selectedObject;
    const selectedFileSize = currentObjectSizeMap.get(target.key);
    handleMenuClose();

    try {
      if (target.isFolder) {
        // Select directory for folder download
        const downloadDir = await open({
            directory: true,
            multiple: false,
            title: '选择目标目录'
        });

        if (downloadDir) {
            const dir = Array.isArray(downloadDir) ? downloadDir[0] : downloadDir;
            const folderName = target.key.split('/').filter(Boolean).pop() || 'folder';
            const localPath = joinLocalPath(dir, folderName);
            await transferApi.queueFolderDownload(bucketName, bucketRegion, target.key, localPath, activeProfileId);
            displaySuccess('文件夹下载已加入队列', '/downloads');
        }
      } else {
        const filename = target.key.split('/').pop() || 'download';
        const savePath = await save({
          defaultPath: filename,
          title: '另存为'
        });

        if (savePath) {
          // Use Transfer Queue
          await transferApi.queueDownload(
              bucketName,
              bucketRegion,
              target.key,
              savePath,
              selectedFileSize || 0,
              true,
              activeProfileId
          );
          displaySuccess('下载已加入队列', '/downloads');
        }
      }
    } catch (err) {
      displayError(`下载失败：${err}`);
    }
  };

  const handleDeletePrompt = () => {
    // Close the menu popup but preserve selectedObject for the delete confirmation
    setMenuAnchorEl(null);
    if (selectedObject) {
       setSelectedKeys(new Set([selectedObject.key]));
       setDeleteConfirmOpen(true);
    } else if (selectedKeys.size > 0) {
       setDeleteConfirmOpen(true);
    }
  };

  // Rename
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ key: string; isFolder: boolean } | null>(null);

  useEffect(() => {
    setRenameOpen(false);
    setRenameTarget(null);
    setRenameValue('');
  }, [viewKey]);

  const handleRenamePrompt = () => {
    if (selectedObject) {
      const name = selectedObject.key.split('/').filter(Boolean).pop() || '';
      setRenameTarget(selectedObject);
      setRenameValue(name);
      setRenameOpen(true);
    }
    handleMenuClose();
  };

  const handleCreateFolderClose = () => {
    if (isCreatingFolder) return;
    setCreateFolderOpen(false);
    setNewFolderName('');
  };

  const handleRenameClose = () => {
    setRenameOpen(false);
    setRenameTarget(null);
    setRenameValue('');
  };

  const handleRename = async () => {
    if (!bucketName || !renameTarget || !renameValue.trim()) return;
    try {
       const oldKey = renameTarget.key;
       const trimmedName = renameValue.trim();
       const normalizedOldKey = renameTarget.isFolder && oldKey.endsWith('/')
         ? oldKey.slice(0, -1)
         : oldKey;
       const parentPrefix = normalizedOldKey.includes('/')
         ? normalizedOldKey.slice(0, normalizedOldKey.lastIndexOf('/') + 1)
         : '';
       const currentName = normalizedOldKey.split('/').pop() || normalizedOldKey;

       if (trimmedName === currentName) {
         setRenameOpen(false);
         setRenameTarget(null);
         return;
       }

       let newKey = `${parentPrefix}${trimmedName}`;
       if (renameTarget.isFolder && !newKey.endsWith('/')) newKey += '/';

       await operationsApi.moveObject(bucketName, bucketRegion, oldKey, bucketName, bucketRegion, newKey);
       displaySuccess('重命名成功');
       setRenameOpen(false);
       setRenameTarget(null);
       setRenameValue('');
       refresh();
    } catch (err) {
       displayError(`重命名失败：${err}`);
    }
  };

  const handlePreviewClose = () => {
    setPreviewOpen(false);
    setPreviewKey(null);
    setPreviewSize(undefined);
    setStartInEditMode(false);
  };

  if (!bucketName) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="error">存储桶名称无效</Typography>
        <Button onClick={() => router.push('/')} sx={{ mt: 2 }}>返回首页</Button>
      </Box>
    );
  }

  // Show error state if bucket failed to load
  // Show error state if bucket failed to load
  if (initialError && !isLoading && !data) {
    // Check if this might be a prefix-restricted access issue
    const isAccessDenied = initialError.toLowerCase().includes('access') ||
                           initialError.toLowerCase().includes('denied') ||
                           initialError.toLowerCase().includes('forbidden') ||
                           initialError.toLowerCase().includes('permission') ||
                           initialError.includes('权限') ||
                           initialError.includes('拒绝') ||
                           initialError.includes('禁止');

    return (
      <Box sx={{
        p: 6,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        maxWidth: 700,
        mx: 'auto',
        mt: 8
      }}>
        <StorageIcon sx={{ fontSize: 80, color: 'text.disabled' }} />
        <Typography variant="h5" fontWeight={600} gutterBottom>
          {isAccessDenied ? '访问受限' : '存储桶不存在'}
        </Typography>
        <Typography color="text.secondary" variant="body1" sx={{ fontFamily: 'monospace', bgcolor: 'action.hover', p: 1, borderRadius: 1, maxWidth: '100%', overflow: 'auto' }}>
          {initialError}
        </Typography>

        {isAccessDenied ? (
          <>
            <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
              你的 AWS 凭据可能对此存储桶权限有限。
            </Typography>
            <Alert severity="info" sx={{ mt: 2, textAlign: 'left', maxWidth: 600 }}>
              <Typography variant="body2" gutterBottom>
                <strong>如果你有权访问特定文件夹/前缀：</strong>
              </Typography>
              <Typography variant="body2" component="div">
                使用顶部导航栏的 <strong>路径栏</strong> 直接跳转到你有权限访问的路径：
              </Typography>
              <Typography variant="body2" component="div" sx={{ mt: 1, fontFamily: 'monospace', bgcolor: 'background.paper', p: 1, borderRadius: 1 }}>
                s3://{bucketName}/your-prefix/
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                示例：s3://my-bucket/team-data/reports/
              </Typography>
            </Alert>
          </>
        ) : (
          <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
            该存储桶可能不存在，或你没有访问它的权限。
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button
            variant="contained"
            startIcon={<HomeIcon />}
            onClick={() => router.push('/')}
          >
            返回首页
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => refresh()}
          >
            重试
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 1, mt: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header & Breadcrumbs */}
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={handleBack} size="small">
          <ArrowBackIcon />
        </IconButton>

        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <Breadcrumbs maxItems={5} itemsBeforeCollapse={2}>

            <Link
              component="button"
              underline="hover"
              color={!prefix ? 'text.primary' : 'inherit'}
              onClick={() => bucketName && handleNavigate('')}
              fontWeight={!prefix ? 800 : 500}
            >
              {bucketName}
            </Link>

            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <Link
                  key={crumb.path}
                  component="button"
                  underline={isLast ? 'none' : 'hover'}
                  color={isLast ? 'text.primary' : 'inherit'}
                  fontWeight={isLast ? 700 : 400}
                  onClick={() => !isLast && handleNavigate(crumb.path)}
                >
                  {crumb.name}
                </Link>
              );
            })}
          </Breadcrumbs>
        </Box>

        <Tooltip title={bucketIsFavorite ? '将存储桶根移出收藏' : '将存储桶根加入收藏'}>
          <IconButton
            size="small"
            color={bucketIsFavorite ? 'warning' : 'default'}
            aria-label={bucketIsFavorite ? '将存储桶根移出收藏' : '将存储桶根加入收藏'}
            aria-pressed={bucketIsFavorite}
            disabled={!bucketName || !activeProfileId}
            onClick={handleToggleBucketFavorite}
          >
            {bucketIsFavorite
              ? <StarIcon fontSize="small" />
              : <StarBorderIcon fontSize="small" />}
          </IconButton>
        </Tooltip>


        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
           <TextField
             placeholder="搜索当前文件夹..."
             size="small"
             value={searchQuery}
             onChange={(e) => setSearchQuery(e.target.value)}
             onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
             InputProps={{
               startAdornment: (
                 <InputAdornment position="start">
                   <SearchIcon color="action" fontSize="small" />
                 </InputAdornment>
               ),
               endAdornment: (
                   <InputAdornment position="end">
                     {searchQuery && (
                         <IconButton size="small" onClick={() => {
                           searchSequenceRef.current += 1;
                           setSearchQuery('');
                           setIsDeepSearch(false);
                           setSearchResults(null);
                           setIsSearching(false);
                         }} edge="end">
                           <CloseIcon fontSize="small" />
                         </IconButton>
                     )}
                   </InputAdornment>
               )
             }}
              sx={{ width: 300, bgcolor: 'background.paper' }}
           />
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 0.5 }}>
              <StyledCheckbox
                aria-label="深度搜索"
                checked={isDeepSearch}
                onChange={(e) => setIsDeepSearch(e.target.checked)}
              />
              <Typography variant="body2" color="text.secondary">深度搜索</Typography>
            </Box>

        {selectedKeys.size > 0 ? (
          <Fade in={selectedKeys.size > 0}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Chip
                label={`${selectedKeys.size} 项已选`}
                size="small"
                color="primary"
                variant="outlined"
                onDelete={() => setSelectedKeys(new Set())}
                sx={{ fontWeight: 700, borderRadius: 1 }}
              />
              <Button
                variant="outlined"
                size="small"
                onClick={handleDownloadSelected}
                startIcon={<DownloadIcon />}
                disabled={isUploading}
                sx={{ fontWeight: 700 }}
              >
                下载
              </Button>
              <Button size="small" variant="outlined" startIcon={<LinkIcon />} sx={{ borderRadius: '999px' }} disabled={!activeProfileId || Array.from(selectedKeys).some(key => currentFolderKeys.has(key))} onClick={() => setPublicLinks({ scope: viewKey, keys: Array.from(selectedKeys) })}>复制公开链接</Button>
               <Button
                variant="contained"
                color="error"
                size="small"
                onClick={handleDeletePrompt}
                startIcon={<DeleteIcon />}
                disabled={isDeleting}
                sx={{ fontWeight: 700 }}
              >
                删除
              </Button>
            </Box>
          </Fade>
        ) : (
          <>
        <Button
          variant="outlined"
          startIcon={<CreateNewFolderIcon />}
          size="small"
          onClick={() => setCreateFolderOpen(true)}
          sx={{ fontWeight: 700 }}
        >
          新建文件夹
        </Button>
        <Button
          variant="contained"
          startIcon={<CloudUploadIcon />}
          endIcon={<ArrowDropDownIcon />}
          size="small"
          disabled={isUploading}
          onClick={(e) => setUploadMenuAnchor(e.currentTarget)}
          sx={{ fontWeight: 700 }}
        >
          上传
        </Button>
        {/* Premium Menu Styled globally via theme.ts */}
        <Menu
            anchorEl={uploadMenuAnchor}
            open={Boolean(uploadMenuAnchor)}
            onClose={() => setUploadMenuAnchor(null)}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            transitionDuration={0}
        >
            <MenuItem onClick={handleUploadFiles}>
                <ListItemIcon><FileIcon fontSize="small" /></ListItemIcon>
                文件
            </MenuItem>
            <MenuItem onClick={handleUploadFolder}>
                <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
                文件夹
            </MenuItem>
            <MenuItem disabled={!activeProfileId} onClick={() => { setUploadMenuAnchor(null); setUrlImportScope(viewKey); }}><ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>从链接导入</MenuItem>
            <MenuItem onClick={() => { setUploadMenuAnchor(null); setSyncDestination(`${activeProfileId}:${bucketName}:${prefix}`); }} disabled={!activeProfileId}>
                <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
                同步本地文件夹...
            </MenuItem>
        </Menu>
          </>
        )}

        <Tooltip title="版本历史，含已删除对象">
            <IconButton size="small" aria-label="版本历史" title="版本历史，含已删除对象" disabled={!activeProfileId} onClick={() => setVersionHistory({ viewKey, key: selectedKeys.size === 1 ? Array.from(selectedKeys)[0] : prefix })}>
              <HistoryIcon fontSize="small" />
            </IconButton>
        </Tooltip>
        <Tooltip title="刷新">
            <IconButton
              onClick={() => refresh()}
              disabled={isLoading}
              color="primary"
              sx={{
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                '&:hover': { bgcolor: 'action.hover' }
              }}
            >
            <RefreshIcon className={isLoading ? 'spin-animation' : ''} />
            </IconButton>
        </Tooltip>
        </Box>
      </Box>





      {/* Content Table - Virtualized for 20k+ objects */}
      <VirtualizedObjectTable
        folders={displayData?.common_prefixes || []}
        objects={displayData?.objects || []}
        selectedKeys={selectedKeys}
        sortField={sortField}
        sortDirection={sortDirection}
        isLoading={isLoading || isSearching}
        onNavigate={handleNavigate}
        onSelect={handleSelect}
        onEndReached={!isDeepSearch && hasMore ? loadMore : undefined}
        isLoadingMore={isLoadingMore}
        onSelectAll={handleSelectAll}
        onMenuOpen={handleMenuOpen}
        onSortChange={(field) => {
          if (sortField === field) {
            setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
          } else {
            setSortField(field);
            setSortDirection(field === 'name' || field === 'class' ? 'asc' : 'desc');
          }
        }}
        onDownload={async (key) => {
          const objectSize = currentObjectSizeMap.get(key) || 0;
          const filename = key.split('/').pop() || 'download';
          const savePath = await save({ defaultPath: filename, title: '另存为' });
          if (savePath && bucketName) {
            const jobId = await transferApi.queueDownload(bucketName, bucketRegion, key, savePath, objectSize, true, activeProfileId);
            // Add to transfer store so it shows in the panel
            addJob({
              id: jobId,
              profile_id: activeProfileId || '',
              transfer_type: 'Download',
              bucket: bucketName,
              bucket_region: bucketRegion,
              key: key,
              local_path: savePath,
              total_bytes: 0,
              processed_bytes: 0,
              status: 'Pending',
              created_at: Date.now(),
            });
            displaySuccess(`正在下载：${filename}`);
          }
        }}
        onDelete={(key) => {
          setSelectedObject({ key, isFolder: key.endsWith('/') });
          setSelectedKeys(new Set([key]));
          setDeleteConfirmOpen(true);
        }}
        onPreview={(key, size) => {
          setPreviewScope(viewKey);
          setStartInEditMode(false);
          setPreviewKey(key);
          setPreviewSize(size);
          setPreviewOpen(true);
        }}
        onEdit={(key) => {
          setPreviewScope(viewKey);
          setStartInEditMode(true);
          setPreviewKey(key);
          setPreviewSize(currentObjectSizeMap.get(key));
          setPreviewOpen(true);
        }}
        onCopyPath={(key) => {
          const s3Uri = `s3://${bucketName}/${key}`;
          copyToClipboard(s3Uri)
            .then(() => displaySuccess(`已复制：${s3Uri}`))
            .catch((err) => displayError('复制路径失败', String(err)));
        }}
      />

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleMenuClose}
        transitionDuration={0}
      >
        {!selectedObject?.isFolder && (
          <MenuItem onClick={handleDownload}>
            <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
            下载
          </MenuItem>
        )}
        {!selectedObject?.isFolder && selectedObject && canObjectBeEdited(getObjectName(selectedObject.key)) && (
          <MenuItem onClick={() => {
            if (selectedObject) {
              setStartInEditMode(true);
              setPreviewScope(viewKey);
              setPreviewKey(selectedObject.key);
              setPreviewSize(currentObjectSizeMap.get(selectedObject.key));
              setPreviewOpen(true);
            }
            handleMenuClose();
          }}>
            <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
            编辑
          </MenuItem>
        )}
        {selectedObject?.isFolder && (
          <MenuItem onClick={async () => {
            if (!selectedObject || !bucketName) return;
            const target = selectedObject;
            handleMenuClose();

            // Get folder to save to
            const folderPath = await open({
              directory: true,
              title: '选择保存文件的文件夹',
            });

            if (!folderPath) return;

            try {
              const dir = Array.isArray(folderPath) ? folderPath[0] : folderPath;
              const folderName = target.key.split('/').filter(Boolean).pop() || 'folder';
              const localPath = joinLocalPath(dir, folderName);

              // Use queueFolderDownload for proper grouping
              const count = await transferApi.queueFolderDownload(bucketName, bucketRegion, target.key, localPath);
              displaySuccess(`已排队下载 ${count} 个文件`, '/downloads');
            } catch (err) {
              displayError('下载文件夹失败', String(err));
            }
          }}>
            <ListItemIcon><FolderZipIcon fontSize="small" /></ListItemIcon>
            下载文件夹
          </MenuItem>
        )}
        <MenuItem onClick={handlePropertiesOpen}>
           <ListItemIcon><InfoIcon fontSize="small" /></ListItemIcon>
           属性
        </MenuItem>
        {!selectedObject?.isFolder && <MenuItem onClick={() => { if (selectedObject) setVersionHistory({ viewKey, key: selectedObject.key }); handleMenuClose(); }}><ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>版本历史</MenuItem>}
        {!selectedObject?.isFolder && <MenuItem onClick={() => { if (selectedObject) setPublicLinks({ scope: viewKey, keys: [selectedObject.key] }); handleMenuClose(); }}><ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>复制公开链接</MenuItem>}
        <MenuItem onClick={handlePermissionsOpen}>
           <ListItemIcon><LockIcon fontSize="small" /></ListItemIcon>
           权限
        </MenuItem>
        <MenuItem onClick={() => {
          if (selectedObject && bucketName) {
            const name = selectedObject.key.split('/').filter(Boolean).pop() || selectedObject.key;
            if (isFavorite(selectedObject.key, bucketName, activeProfileId || undefined)) {
              removeFavorite(selectedObject.key, bucketName, activeProfileId || undefined);
              displaySuccess('已从收藏移除');
            } else {
              addFavorite({
                key: selectedObject.key,
                name,
                bucket: bucketName,
                region: bucketRegion,
                profileId: activeProfileId || undefined,
                isFolder: selectedObject.isFolder,
              });
              displaySuccess('已加入收藏');
            }
          }
          handleMenuClose();
        }}>
          <ListItemIcon>
            {selectedObject && isFavorite(selectedObject.key, bucketName || undefined, activeProfileId || undefined)
              ? <StarIcon fontSize="small" color="warning" />
              : <StarBorderIcon fontSize="small" />}
          </ListItemIcon>
          {selectedObject && isFavorite(selectedObject.key, bucketName || undefined, activeProfileId || undefined) ? '移出收藏' : '加入收藏'}
        </MenuItem>
        {!selectedObject?.isFolder && (
          <MenuItem onClick={() => {
            if (selectedObject) {
              setPresignedUrlKey(selectedObject.key);
              setPresignedUrlOpen(true);
            }
            handleMenuClose();
          }}>
            <ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>
            获取预签名URL
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => {
          if (selectedObject) {
            const filename = selectedObject.key.split('/').filter(Boolean).pop() || selectedObject.key;
            copyToClipboard(filename)
              .then(() => displaySuccess(`已复制文件名：${filename}`))
              .catch((err) => displayError('复制文件名失败', String(err)));
          }
          handleMenuClose();
        }}>
          <ListItemIcon><FilePresentIcon fontSize="small" /></ListItemIcon>
          复制文件名
        </MenuItem>
        <MenuItem onClick={() => {
          if (selectedObject) {
            copyToClipboard(selectedObject.key)
              .then(() => displaySuccess(`已复制 Key：${selectedObject.key}`))
              .catch((err) => displayError('复制 Key 失败', String(err)));
          }
          handleMenuClose();
        }}>
          <ListItemIcon><FileCopyIcon fontSize="small" /></ListItemIcon>
          复制 Key
        </MenuItem>
        <MenuItem onClick={() => {
          if (selectedObject) {
            const s3Uri = `s3://${bucketName}/${selectedObject.key}`;
            copyToClipboard(s3Uri)
              .then(() => displaySuccess(`已复制 S3 URI：${s3Uri}`))
              .catch((err) => displayError('复制 S3 URI 失败', String(err)));
          }
          handleMenuClose();
        }}>
          <ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>
          复制 S3 URI
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleRenamePrompt}>
          <ListItemIcon><RenameIcon fontSize="small" /></ListItemIcon>
          重命名
        </MenuItem>
        <MenuItem onClick={handleDeletePrompt} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          删除
        </MenuItem>
      </Menu>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderOpen} onClose={handleCreateFolderClose}>
        <DialogTitle>新建文件夹</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="文件夹名称"
            fullWidth
            variant="outlined"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault(); // Prevent double submission
                    if (newFolderName.trim() && !newFolderName.includes('/') && !newFolderName.includes('\\')) {
                        handleCreateFolder();
                    }
                }
            }}
            error={newFolderName.includes('/') || newFolderName.includes('\\')}
            helperText={
                (newFolderName.includes('/') || newFolderName.includes('\\'))
                ? "文件夹名称不能包含斜杠"
                : ""
            }
            sx={{ mt: 1 }}
            inputProps={{ autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreateFolderClose}>取消</Button>
          <Button
            onClick={handleCreateFolder}
            disabled={
                isCreatingFolder ||
                !newFolderName.trim() ||
                newFolderName.includes('/') ||
                newFolderName.includes('\\')
            }
          >
            {isCreatingFolder ? '创建中...' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onClose={handleRenameClose}>
        <DialogTitle>重命名</DialogTitle>
        <DialogContent>
          <TextField
             autoFocus
             margin="dense"
             label="新名称"
             fullWidth
             variant="outlined"
             value={renameValue}
             onChange={(e) => setRenameValue(e.target.value)}
             onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (renameValue.trim() && !renameValue.includes('/') && !renameValue.includes('\\')) {
                        handleRename();
                    }
                }
             }}
             error={renameValue.includes('/') || renameValue.includes('\\')}
             helperText={
                (renameValue.includes('/') || renameValue.includes('\\'))
                ? "名称不能包含斜杠"
                : ""
             }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRenameClose}>取消</Button>
          <Button
            onClick={handleRename}
            disabled={
                !renameValue.trim() ||
                renameValue.includes('/') ||
                renameValue.includes('\\')
            }
          >
            重命名
          </Button>
        </DialogActions>
      </Dialog>

      {/* Properties Dialog */}
      {activeProfileId && syncDestination === `${activeProfileId}:${bucketName}:${prefix}` && <FolderSyncDialog key={syncDestination} bucket={bucketName} region={bucketRegion} prefix={prefix} profileId={activeProfileId} onClose={() => setSyncDestination(null)} />}
      {activeProfileId && crossCopy?.viewKey === viewKey && <CrossProfileCopyDialog key={viewKey} items={crossCopy.items} bucket={bucketName} region={bucketRegion} prefix={prefix} profileId={activeProfileId} onClose={() => setCrossCopy(null)} />}
      {activeProfileId && versionHistory?.viewKey === viewKey && <VersionHistoryDialog key={`${viewKey}:${versionHistory.key}`} bucket={bucketName} region={bucketRegion} profileId={activeProfileId} initialKey={versionHistory.key} onClose={() => setVersionHistory(null)} />}
      <PropertiesDialog
        open={propertiesOpen}
        onClose={() => setPropertiesOpen(false)}
        bucketName={bucketName}
        bucketRegion={bucketRegion}
        objectKey={selectedObjectProp || ''}
      />

      <PermissionsDialog
        open={permissionsOpen}
        onClose={() => setPermissionsOpen(false)}
        bucketName={bucketName}
        bucketRegion={bucketRegion}
        objectKey={selectedObjectPermissions?.key || ''}
        isFolder={selectedObjectPermissions?.isFolder || false}
      />

      {/* Preview/Edit Dialog */}
      <ObjectPreviewDialog
        key={`preview:${viewKey}`}
        open={previewOpen && previewScope === viewKey}
        onClose={handlePreviewClose}
        bucketName={bucketName}
        bucketRegion={bucketRegion}
        objectKey={previewKey || ''}
        objectSize={previewSize}
        navigation={{ index: previewNavigation.index, total: previewNavigation.total, busy: previewNavigation.busy, error: previewNavigation.error,
          onPrevious: previewNavigation.previous ? () => void previewNavigation.navigate('prev') : undefined,
          onNext: previewNavigation.next ? () => void previewNavigation.navigate('next') : undefined }}
        isSelected={!!previewKey && selectedKeys.has(previewKey)}
        onToggleSelect={previewKey && previewScope === viewKey ? () => handleSelect(previewKey, !selectedKeys.has(previewKey)) : undefined}
        onSave={() => refresh()}
        startInEditMode={startInEditMode}
      />

      {/* Presigned URL Dialog */}
      {activeProfileId && urlImportScope === viewKey && <UrlImportDialog key={`url-import:${viewKey}`} bucket={bucketName} region={bucketRegion} prefix={prefix} profileId={activeProfileId} onClose={() => setUrlImportScope(null)} />}
      {activeProfileId && publicLinks?.scope === viewKey && <PublicUrlsDialog key={`public-links:${viewKey}`} bucket={bucketName} region={bucketRegion} keys={publicLinks.keys} profileId={activeProfileId} onClose={() => setPublicLinks(null)} />}
      <PresignedUrlDialog
        open={presignedUrlOpen}
        onClose={() => { setPresignedUrlOpen(false); setPresignedUrlKey(null); }}
        bucketName={bucketName || ''}
        bucketRegion={bucketRegion}
        objectKey={presignedUrlKey || ''}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setSelectedObject(null);
        }}
        onConfirm={() => {
           // Always use bulk delete - it handles both single items and folders recursively
           handleBulkDelete();
           setSelectedObject(null);
        }}
        title="删除确认"
        message={
          <>
            确定要删除 <strong>{selectedObject ? selectedObject.key.split('/').filter(Boolean).pop() : `${selectedKeys.size} 个项目`}</strong> 吗？
            {(selectedObject?.isFolder || (selectedKeys.size > 0)) && (
               <Box component="span" sx={{ display: 'block', mt: 1, color: 'warning.main', fontSize: '0.9em', fontWeight: 600 }}>
                 警告：此操作不可撤销。
               </Box>
            )}
          </>
        }
        confirmLabel={isDeleting ? '删除中...' : '删除'}
        isDestructive
        isLoading={isDeleting}
      />

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-animation { animation: spin 1s linear infinite; }
      `}</style>
    </Box>
  );
}

export default function BucketPage() {
  return (
    <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>}>
      <BucketContent />
    </Suspense>
  );
}
