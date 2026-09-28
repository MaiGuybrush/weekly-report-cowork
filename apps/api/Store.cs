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
            CREATE TABLE IF NOT EXISTS users(emp_no TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, section TEXT);
            CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, meeting_date TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), continuity_id TEXT NOT NULL, section TEXT NOT NULL, owner_section TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', version INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS leases(item_id TEXT PRIMARY KEY REFERENCES items(id), holder TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, base_version INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS drafts(item_id TEXT NOT NULL REFERENCES items(id), editor TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', saved_at TEXT NOT NULL, PRIMARY KEY(item_id,editor));
            CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, before_version INTEGER NOT NULL, after_version INTEGER NOT NULL, before_title TEXT NOT NULL, after_title TEXT NOT NULL, before_content TEXT NOT NULL, after_content TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, reason TEXT);
            CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), version INTEGER NOT NULL, request_id TEXT, published_by TEXT NOT NULL, published_at TEXT NOT NULL, snapshot TEXT NOT NULL, UNIQUE(report_id, version), UNIQUE(report_id, request_id));
            """).ExecuteNonQuery();
        EnsureColumn(db, "items", "continuity_id", "TEXT");
        EnsureColumn(db, "items", "status", "TEXT NOT NULL DEFAULT 'open'");
        EnsureColumn(db, "drafts", "status", "TEXT NOT NULL DEFAULT 'open'");
        Sql(db, "UPDATE items SET continuity_id=id WHERE continuity_id IS NULL OR continuity_id='' ").ExecuteNonQuery();
        foreach (var user in config.GetSection("Access:Users").GetChildren())
        {
            var empNo = user["EmpNo"];
            var role = user["Role"];
            if (string.IsNullOrWhiteSpace(empNo) || role is not ("Guy" or "Head" or "Reader")) continue;
            Sql(db, "INSERT INTO users(emp_no,name,role,section) VALUES($id,$name,$role,$section) ON CONFLICT(emp_no) DO NOTHING",
                ("$id", empNo), ("$name", user["Name"] ?? empNo), ("$role", role), ("$section", user["Section"])).ExecuteNonQuery();
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
