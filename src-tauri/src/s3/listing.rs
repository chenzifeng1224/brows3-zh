use crate::error::{AppError, Result};
use aws_sdk_s3::{types::Object, Client};
use std::collections::HashSet;

/// Bounded preflight: callers must finish enumeration before mutating anything.
pub async fn list_recursive(client: &Client, bucket: &str, prefix: &str) -> Result<Vec<Object>> {
    tokio::time::timeout(std::time::Duration::from_secs(120), async {
        let mut objects = Vec::new();
        let mut token = None;
        let mut seen = HashSet::new();
        for _ in 0..100 {
            let page = client
                .list_objects_v2()
                .bucket(bucket)
                .prefix(prefix)
                .max_keys(1000)
                .set_continuation_token(token)
                .send()
                .await
                .map_err(|error| AppError::S3Error(error.to_string()))?;
            objects.extend_from_slice(page.contents());
            if objects.len() > 100_000 {
                return Err(AppError::ConfigError(
                    "文件夹超过 100,000 个对象，请选择更小的前缀。".into(),
                ));
            }
            if !page.is_truncated().unwrap_or(false) {
                return Ok(objects);
            }
            let next = page
                .next_continuation_token()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::S3Error("列表不完整：缺少 continuation token".into())
                })?;
            if !seen.insert(next.to_string()) {
                return Err(AppError::S3Error(
                    "列表不完整：continuation token 重复".into(),
                ));
            }
            token = Some(next.to_string());
        }
        Err(AppError::ConfigError(
            "文件夹的列表结果超过 100 页，请选择更小的前缀。".into(),
        ))
    })
    .await
    .map_err(|_| {
        AppError::S3Error("文件夹列表超时；未加入任何任务，也未做任何修改。".into())
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_s3::{response, scripted_client};

    #[tokio::test]
    async fn incomplete_and_repeated_cursors_fail_preflight() {
        for pages in [vec!["<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>"],
            vec!["<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same</NextContinuationToken></ListBucketResult>"; 2]] {
            let (client, server) = scripted_client(pages.into_iter().map(|body| response(200, "", body)).collect()).await;
            assert!(list_recursive(&client, "bucket", "folder/").await.is_err());
            server.await.unwrap();
        }
    }
}
