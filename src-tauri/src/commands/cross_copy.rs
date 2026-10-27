use super::{profiles::ProfileState, transfer::TransferState};
use crate::{
    error::{AppError, Result},
    s3::S3State,
    transfer::{
        remote::{self, RemoteSource},
        TransferJob, TransferType,
    },
};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    time::Duration,
};
use tauri::{AppHandle, State};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItem {
    pub profile_id: String,
    pub bucket: String,
    pub region: String,
    pub key: String,
    pub is_folder: bool,
}

fn destination_key(item: &CopyItem, key: &str, prefix: &str) -> Result<String> {
    if item.key.is_empty() || (item.is_folder && !item.key.ends_with('/')) {
        return Err(AppError::ConfigError(
            "请选择文件或有名称的文件夹，不能选择存储桶根目录。".into(),
        ));
    }
    let selected = if item.is_folder {
        item.key.strip_suffix('/').unwrap()
    } else {
        &item.key
    };
    let name = selected
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .ok_or_else(|| AppError::ConfigError("源名称无效".into()))?;
    let suffix = if item.is_folder {
        format!(
            "/{rest}",
            rest = key
                .strip_prefix(&item.key)
                .ok_or_else(|| AppError::S3Error(
                    "源列表返回了不相关的键。".into()
                ))?
        )
    } else {
        if key != item.key {
            return Err(AppError::ConfigError("源键不匹配".into()));
        }
        String::new()
    };
    let result = format!("{prefix}{name}{suffix}");
    if result.len() > 1024 {
        return Err(AppError::ConfigError(
            "目标键超过 1,024 字节。".into(),
        ));
    }
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn copy_between_profiles(
    items: Vec<CopyItem>,
    destination_bucket: String,
    destination_region: String,
    destination_prefix: String,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
    app_handle: AppHandle,
) -> Result<usize> {
    if items.is_empty()
        || items.len() > 10_000
        || destination_bucket.is_empty()
        || destination_region.is_empty()
        || (!destination_prefix.is_empty() && !destination_prefix.ends_with('/'))
    {
        return Err(AppError::ConfigError(
            "请选择 1 到 10,000 个源项目以及目标文件夹。".into(),
        ));
    }
    let source_id = &items[0].profile_id;
    if source_id == &expected_profile_id
        || items
            .iter()
            .any(|i| i.profile_id != *source_id || i.bucket.is_empty() || i.region.is_empty())
    {
        return Err(AppError::ConfigError(
            "跨配置复制需要一个源配置和另一个不同的目标配置。"
                .into(),
        ));
    }
    let (source, destination) = {
        let profiles = profile_state.read().await;
        let active = profiles
            .get_active_profile()
            .await?
            .ok_or_else(|| AppError::ConfigError("请选择目标配置。".into()))?;
        super::operations::validate_operation_profile(Some(&expected_profile_id), &active.id)?;
        (profiles.get_profile(source_id).await?, active)
    };
    let mut clients = HashMap::new();
    {
        let mut s3 = s3_state.write().await;
        for item in &items {
            if !clients.contains_key(&item.region) {
                clients.insert(
                    item.region.clone(),
                    s3.get_client_for_region(&source, &item.region)
                        .await?
                        .clone(),
                );
            }
        }
    }
    // No jobs or writes until the complete bounded preflight succeeds.
    let jobs = tokio::time::timeout(Duration::from_secs(120), async {
        let mut sources = HashSet::new();
        let mut destinations = HashMap::new();
        let mut jobs = Vec::new();
        let group = uuid::Uuid::new_v4().to_string();
        for item in &items {
            destination_key(item, &item.key, &destination_prefix)?;
            let client = &clients[&item.region];
            let keys = if item.is_folder {
                crate::s3::listing::list_recursive(client, &item.bucket, &item.key)
                    .await?
                    .into_iter()
                    .map(|o| {
                        o.key.ok_or_else(|| {
                            AppError::S3Error("源列表中存在无名称的对象。".into())
                        })
                    })
                    .collect::<Result<Vec<_>>>()?
            } else {
                vec![item.key.clone()]
            };
            for key in keys {
                let target = destination_key(item, &key, &destination_prefix)?;
                let identity = (item.bucket.clone(), key.clone());
                if let Some(previous) = destinations.insert(target.clone(), identity.clone()) {
                    if previous != identity {
                        return Err(AppError::ConfigError(format!(
                            "多个源对象映射到 {target}，请分别选择。"
                        )));
                    }
                    continue;
                }
                if !sources.insert((identity, target.clone())) {
                    continue;
                }
                if jobs.len() >= 10_000 {
                    return Err(AppError::ConfigError(
                        "复制数量超过 10,000 个对象，请选择更小的文件夹。".into(),
                    ));
                }
                let head = client
                    .head_object()
                    .bucket(&item.bucket)
                    .key(&key)
                    .send()
                    .await
                    .map_err(|e| AppError::S3Error(format!("无法检查源对象 {key}：{e}")))?;
                let (etag, size) = remote::validate_head(&head)?;
                let mut job = TransferJob::new(
                    TransferType::Upload,
                    destination.id.clone(),
                    destination_bucket.clone(),
                    Some(destination_region.clone()),
                    target,
                    PathBuf::new(),
                    size * 2,
                )
                .with_group(
                    group.clone(),
                    format!("复制：{} → {}", source.name, destination.name),
                );
                job.remote_source = Some(RemoteSource {
                    profile_id: source.id.clone(),
                    profile_identity: source.cache_identity(),
                    destination_identity: destination.cache_identity(),
                    bucket: item.bucket.clone(),
                    region: item.region.clone(),
                    key,
                    etag,
                    version_id: None,
                    size,
                    current_session: true,
                });
                jobs.push(job);
            }
        }
        Ok::<_, AppError>(jobs)
    })
    .await
    .map_err(|_| {
        AppError::S3Error(
            "复制准备超时，未加入任何任务。请减少选择的对象数量。".into(),
        )
    })??;
    {
        let profiles = profile_state.read().await;
        let active = profiles
            .get_active_profile()
            .await?
            .ok_or_else(|| AppError::ConfigError("目标配置已更改。".into()))?;
        if active.cache_identity() != destination.cache_identity()
            || profiles.get_profile(source_id).await?.cache_identity() != source.cache_identity()
        {
            return Err(AppError::ConfigError(
                "准备过程中配置设置已更改，请重新复制。".into(),
            ));
        }
    }
    let ids: Vec<_> = jobs.iter().map(|j| j.id.clone()).collect();
    let count = jobs.len();
    transfer_state.set_app_handle(app_handle).await;
    transfer_state.add_jobs(jobs).await;
    for id in ids {
        if let Some(job) = transfer_state.get_job(&id).await {
            if let crate::transfer::TransferStatus::Failed(error) = job.status {
                return Err(AppError::IoError(error));
            }
        }
    }
    transfer_state
        .inner()
        .clone()
        .process_queue(s3_state.inner().clone(), profile_state.inner().clone())
        .await;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(key: &str, folder: bool) -> CopyItem {
        CopyItem {
            profile_id: "source".into(),
            bucket: "b".into(),
            region: "r".into(),
            key: key.into(),
            is_folder: folder,
        }
    }
    #[test]
    fn mappings_preserve_literal_keys_and_reject_invalid_selection() {
        assert_eq!(
            destination_key(&item("a/folder/", true), "a/folder/x//../☃", "to/").unwrap(),
            "to/folder/x//../☃"
        );
        assert_eq!(
            destination_key(&item("a/folder/", true), "a/folder/", "").unwrap(),
            "folder/"
        );
        assert_eq!(
            destination_key(&item("a/file.txt", false), "a/file.txt", "to/").unwrap(),
            "to/file.txt"
        );
        assert!(destination_key(&item("", true), "x", "").is_err());
        assert!(destination_key(&item("a/", true), "another/x", "").is_err());
        assert!(destination_key(&item("a", true), "a", "").is_err());
        assert!(destination_key(&item("x", false), "x", &"x".repeat(1024)).is_err());
    }
}
