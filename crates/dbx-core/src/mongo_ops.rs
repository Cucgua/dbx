use crate::connection::{AppState, PoolKind};
use crate::db::agent_driver::mongo_document_id_params;
use crate::db::elasticsearch_driver;
use crate::db::mongo_driver::{self, MongoDocumentResult};

pub async fn mongo_list_databases_core(state: &AppState, connection_id: &str) -> Result<Vec<String>, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::list_databases(client).await,
        PoolKind::Elasticsearch(_) => Ok(vec!["default".to_string()]),
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            let result: Vec<serde_json::Value> = client.mongo_list_databases().await?;
            Ok(result.iter().filter_map(|v| v.get("name")?.as_str().map(String::from)).collect())
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_list_collections_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> Result<Vec<String>, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::list_collections(client, database).await,
        PoolKind::Elasticsearch(client) => elasticsearch_driver::list_indices(client).await,
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            client.mongo_list_collections(database).await
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn mongo_find_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    skip: u64,
    limit: i64,
    filter: Option<&str>,
    sort: Option<&str>,
) -> Result<MongoDocumentResult, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => {
            mongo_driver::find_documents(client, database, collection, skip, limit, filter, sort).await
        }
        PoolKind::Elasticsearch(client) => {
            let client = client.clone();
            drop(connections);
            elasticsearch_driver::find_documents(&client, collection, skip, limit).await
        }
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            client
                .mongo_find_documents(serde_json::json!({
                    "database": database,
                    "collection": collection,
                    "skip": skip,
                    "limit": limit,
                    "filter": filter,
                    "sort": sort,
                }))
                .await
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_aggregate_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    pipeline_json: &str,
    max_rows: Option<usize>,
) -> Result<MongoDocumentResult, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => {
            mongo_driver::aggregate_documents(client, database, collection, pipeline_json, max_rows).await
        }
        PoolKind::Agent(_) => Err("MongoDB legacy agent does not support aggregate".to_string()),
        _ => Err("Not a MongoDB connection".to_string()),
    }
}

pub async fn mongo_insert_document_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    doc_json: &str,
) -> Result<String, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::insert_document(client, database, collection, doc_json).await,
        PoolKind::Elasticsearch(client) => {
            let client = client.clone();
            drop(connections);
            elasticsearch_driver::insert_document(&client, collection, doc_json).await
        }
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            let result: serde_json::Value = client
                .mongo_insert_document(serde_json::json!({
                    "database": database,
                    "collection": collection,
                    "doc_json": doc_json,
                }))
                .await?;
            Ok(result.get("inserted_id").and_then(|v| v.as_str()).unwrap_or("").to_string())
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_insert_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    docs_json: &str,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::insert_documents(client, database, collection, docs_json).await,
        PoolKind::Agent(_) => Err("MongoDB legacy agent does not support bulk insertMany/insertOne writes".to_string()),
        _ => Err("Not a MongoDB connection".to_string()),
    }
}

pub async fn mongo_update_document_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    id: &str,
    doc_json: &str,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::update_document(client, database, collection, id, doc_json).await,
        PoolKind::Elasticsearch(client) => {
            let client = client.clone();
            drop(connections);
            elasticsearch_driver::update_document(&client, collection, id, doc_json).await
        }
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            let result: serde_json::Value = client
                .mongo_update_document(serde_json::json!({
                    "database": database,
                    "collection": collection,
                    "id": id,
                    "doc_json": doc_json,
                }))
                .await?;
            Ok(result.get("modified_count").and_then(|v| v.as_u64()).unwrap_or(0))
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_update_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter_json: &str,
    update_json: &str,
    many: bool,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => {
            mongo_driver::update_documents(client, database, collection, filter_json, update_json, many).await
        }
        PoolKind::Agent(_) => Err("MongoDB legacy agent does not support bulk updateOne/updateMany writes".to_string()),
        _ => Err("Not a MongoDB connection".to_string()),
    }
}

pub async fn mongo_delete_document_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    id: &str,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::delete_document(client, database, collection, id).await,
        PoolKind::Elasticsearch(client) => {
            let client = client.clone();
            drop(connections);
            elasticsearch_driver::delete_document(&client, collection, id).await
        }
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            let result: serde_json::Value =
                client.mongo_delete_document(mongo_document_id_params(database, collection, id)).await?;
            Ok(result.get("deleted_count").and_then(|v| v.as_u64()).unwrap_or(0))
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_delete_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter_json: &str,
    many: bool,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => {
            mongo_driver::delete_documents(client, database, collection, filter_json, many).await
        }
        PoolKind::Agent(_) => Err("MongoDB legacy agent does not support bulk deleteOne/deleteMany writes".to_string()),
        _ => Err("Not a MongoDB connection".to_string()),
    }
}
