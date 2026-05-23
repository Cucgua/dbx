use dbx_core::sql_analysis::analyze_sql_references;

#[test]
fn extracts_tables_aliases_and_qualified_columns() {
    let analysis = analyze_sql_references("select u.missing from users u where u.id = 1", Some("postgres")).unwrap();

    assert_eq!(analysis.tables.len(), 1);
    assert_eq!(analysis.tables[0].name, "users");
    assert_eq!(analysis.tables[0].alias.as_deref(), Some("u"));

    let columns: Vec<_> =
        analysis.columns.iter().map(|column| (column.qualifier.as_deref(), column.name.as_str())).collect();
    assert_eq!(columns, vec![(Some("u"), "missing"), (Some("u"), "id")]);
}

#[test]
fn extracts_unqualified_columns_from_single_table_select() {
    let analysis = analyze_sql_references("select missing, id from users", Some("postgres")).unwrap();

    let columns: Vec<_> =
        analysis.columns.iter().map(|column| (column.qualifier.as_deref(), column.name.as_str())).collect();
    assert_eq!(columns, vec![(None, "missing"), (None, "id")]);
}
