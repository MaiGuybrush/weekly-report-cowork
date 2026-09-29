using Microsoft.Data.Sqlite;

public sealed class Store(IConfiguration config)
{
    readonly string path = Path.GetFullPath(config["DatabasePath"] ?? "weekly-report.db");

    public SqliteConnection Open()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var db = new SqliteConnection($"Data Source={path};Foreign Keys=True;Default Timeout=10");
        db.Open();
        return db;
    }

    public void Initialize()
    {
        using var db = Open();
        Sql(db, "PRAGMA journal_mode=WAL").ExecuteNonQuery();
        Sql(db, """
            CREATE TABLE IF NOT EXISTS users(emp_no TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, section TEXT, reader_access INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, meeting_date TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), continuity_id TEXT NOT NULL, section TEXT NOT NULL, owner_section TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', version INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS leases(item_id TEXT PRIMARY KEY REFERENCES items(id), holder TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, base_version INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS drafts(item_id TEXT NOT NULL REFERENCES items(id), editor TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', saved_at TEXT NOT NULL, PRIMARY KEY(item_id,editor));
            CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, before_version INTEGER NOT NULL, after_version INTEGER NOT NULL, before_title TEXT NOT NULL, after_title TEXT NOT NULL, before_content TEXT NOT NULL, after_content TEXT NOT NULL, before_details TEXT NOT NULL DEFAULT '{}', after_details TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, reason TEXT);
            CREATE TABLE IF NOT EXISTS access_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, target_emp_no TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, before_role TEXT, after_role TEXT NOT NULL, before_reader_access INTEGER, after_reader_access INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), version INTEGER NOT NULL, request_id TEXT, published_by TEXT NOT NULL, published_at TEXT NOT NULL, snapshot TEXT NOT NULL, UNIQUE(report_id, version), UNIQUE(report_id, request_id));
            CREATE TABLE IF NOT EXISTS project_participants(project_id TEXT NOT NULL REFERENCES items(id), section TEXT NOT NULL, PRIMARY KEY(project_id, section));
            CREATE TABLE IF NOT EXISTS project_work(project_id TEXT NOT NULL REFERENCES items(id), section TEXT NOT NULL, work TEXT NOT NULL, schedule_proposal TEXT, version INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id, section));
            CREATE TABLE IF NOT EXISTS project_work_revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES items(id), section TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, before_version INTEGER NOT NULL, after_version INTEGER NOT NULL, before_work TEXT NOT NULL, after_work TEXT NOT NULL, before_schedule_proposal TEXT, after_schedule_proposal TEXT);
            CREATE TABLE IF NOT EXISTS project_schedule_entries(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES items(id), kind TEXT NOT NULL, name TEXT NOT NULL, baseline_start TEXT, baseline_end TEXT, forecast_start TEXT, forecast_end TEXT, actual_start TEXT, actual_end TEXT, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS project_baseline_history(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL REFERENCES project_schedule_entries(id), actor TEXT NOT NULL, at TEXT NOT NULL, before_baseline_start TEXT, before_baseline_end TEXT, after_baseline_start TEXT, after_baseline_end TEXT, reason TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS project_schedule_revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL REFERENCES project_schedule_entries(id), actor TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, reason TEXT, before_state TEXT, after_state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS project_schedule_dependencies(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES items(id), predecessor_id TEXT NOT NULL REFERENCES project_schedule_entries(id), successor_id TEXT NOT NULL REFERENCES project_schedule_entries(id), created_by TEXT NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL, UNIQUE(predecessor_id, successor_id));
            CREATE TABLE IF NOT EXISTS ecim_import_runs(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), section TEXT NOT NULL, period_from TEXT, period_to TEXT, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ecim_member_results(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES ecim_import_runs(id), user_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT, work_count INTEGER NOT NULL DEFAULT 0, last_success_at TEXT);
            CREATE TABLE IF NOT EXISTS ecim_member_sync_state(section TEXT NOT NULL, user_id TEXT NOT NULL, last_success_at TEXT, PRIMARY KEY(section,user_id));
            CREATE TABLE IF NOT EXISTS ecim_sources(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), section TEXT NOT NULL, work_id TEXT NOT NULL, period_from TEXT NOT NULL, period_to TEXT NOT NULL, payload TEXT NOT NULL, import_run_id TEXT NOT NULL REFERENCES ecim_import_runs(id), UNIQUE(report_id,work_id,period_from,period_to));
            CREATE TABLE IF NOT EXISTS ecim_candidates(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), source_id TEXT NOT NULL REFERENCES ecim_sources(id), section TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', candidate_type TEXT NOT NULL DEFAULT 'new-source', reason TEXT, target_item_id TEXT REFERENCES items(id), decided_by TEXT, decided_at TEXT, UNIQUE(source_id));
            CREATE TABLE IF NOT EXISTS field_origins(item_id TEXT NOT NULL REFERENCES items(id), field_name TEXT NOT NULL, last_source_value TEXT, latest_source_value TEXT NOT NULL, report_value TEXT NOT NULL, human_override INTEGER NOT NULL DEFAULT 0, edited_at TEXT NOT NULL, PRIMARY KEY(item_id,field_name));
            """).ExecuteNonQuery();
        EnsureColumn(db, "items", "continuity_id", "TEXT");
        EnsureColumn(db, "items", "status", "TEXT NOT NULL DEFAULT 'open'");
        EnsureColumn(db, "items", "details", "TEXT NOT NULL DEFAULT '{}'");
        EnsureColumn(db, "drafts", "status", "TEXT NOT NULL DEFAULT 'open'");
        EnsureColumn(db, "drafts", "details", "TEXT NOT NULL DEFAULT '{}'");
        EnsureColumn(db, "revisions", "before_details", "TEXT NOT NULL DEFAULT '{}'");
        EnsureColumn(db, "revisions", "after_details", "TEXT NOT NULL DEFAULT '{}'");
        EnsureColumn(db, "users", "reader_access", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(db, "access_audit", "before_reader_access", "INTEGER");
        EnsureColumn(db, "access_audit", "after_reader_access", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(db, "project_work", "version", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(db, "project_schedule_entries", "state", "TEXT NOT NULL DEFAULT 'open'");
        EnsureColumn(db, "project_schedule_entries", "owner", "TEXT");
        EnsureColumn(db, "project_schedule_entries", "phase_id", "TEXT REFERENCES project_schedule_entries(id)");
        EnsureColumn(db, "project_schedule_entries", "baseline_date", "TEXT");
        EnsureColumn(db, "project_schedule_entries", "forecast_date", "TEXT");
        EnsureColumn(db, "project_schedule_entries", "actual_date", "TEXT");
        EnsureColumn(db, "ecim_candidates", "candidate_type", "TEXT NOT NULL DEFAULT 'new-source'");
        EnsureColumn(db, "ecim_candidates", "reason", "TEXT");
        EnsureColumn(db, "ecim_candidates", "target_item_id", "TEXT");
        EnsureColumn(db, "ecim_candidates", "decided_by", "TEXT");
        EnsureColumn(db, "ecim_candidates", "decided_at", "TEXT");
        Sql(db, "UPDATE items SET continuity_id=id WHERE continuity_id IS NULL OR continuity_id='' ").ExecuteNonQuery();
        Sql(db, "UPDATE users SET reader_access=1 WHERE role='Reader'").ExecuteNonQuery();
        foreach (var user in config.GetSection("Access:Users").GetChildren())
        {
            var empNo = user["EmpNo"];
            var role = user["Role"];
            if (string.IsNullOrWhiteSpace(empNo) || role is not ("Guy" or "Head" or "Reader")) continue;
            Sql(db, "INSERT INTO users(emp_no,name,role,section,reader_access) VALUES($id,$name,$role,$section,$reader) ON CONFLICT(emp_no) DO NOTHING",
                ("$id", empNo), ("$name", user["Name"] ?? empNo), ("$role", role), ("$section", user["Section"]), ("$reader", role == "Reader" ? 1 : 0)).ExecuteNonQuery();
        }
    }

    public static SqliteCommand Sql(SqliteConnection db, string query, params (string Name, object? Value)[] args)
    {
        var cmd = db.CreateCommand();
        cmd.CommandText = query;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }

    static void EnsureColumn(SqliteConnection db, string table, string column, string definition)
    {
        using var columns = Sql(db, $"PRAGMA table_info({table})").ExecuteReader();
        while (columns.Read()) if (columns.GetString(1) == column) return;
        columns.Close();
        Sql(db, $"ALTER TABLE {table} ADD COLUMN {column} {definition}").ExecuteNonQuery();
    }
}
