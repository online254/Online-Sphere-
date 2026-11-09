CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL,
    permission TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, permission),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER,
    action TEXT NOT NULL,
    affected_table TEXT,
    affected_record_id TEXT,
    previous_value TEXT,
    updated_value TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    avatar_url TEXT,
    bio TEXT,
    country TEXT,
    city TEXT,
    language_preference TEXT DEFAULT 'en',
    is_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    is_published INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    category TEXT,
    status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    video_url TEXT,
    duration_minutes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_course_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    progress_percent INTEGER DEFAULT 0,
    last_seen_at DATETIME,
    UNIQUE(user_id, course_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_user_id INTEGER NOT NULL,
    referred_user_id INTEGER NOT NULL,
    referral_code TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(referred_user_id),
    FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_user_id INTEGER NOT NULL,
    referred_user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    rate_percent INTEGER DEFAULT 10,
    status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'membership_activation',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT,
    description TEXT,
    status TEXT DEFAULT 'draft',
    budget INTEGER,
    currency TEXT DEFAULT 'KES',
    deadline TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    assignee_user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'assigned',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    note TEXT,
    file_url TEXT,
    status TEXT DEFAULT 'submitted',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_name TEXT NOT NULL UNIQUE,
    value_text TEXT,
    value_json TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    package_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    merchant_request_id TEXT,
    checkout_request_id TEXT UNIQUE,
    mpesa_receipt TEXT UNIQUE,
    result_code INTEGER,
    result_description TEXT,
    transaction_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO roles (name) VALUES ('member');
INSERT OR IGNORE INTO roles (name) VALUES ('super_admin');

INSERT OR IGNORE INTO permissions (name) VALUES ('member:dashboard');
INSERT OR IGNORE INTO permissions (name) VALUES ('member:wallet');
INSERT OR IGNORE INTO permissions (name) VALUES ('admin:overview');
INSERT OR IGNORE INTO permissions (name) VALUES ('admin:members');
INSERT OR IGNORE INTO permissions (name) VALUES ('admin:financials');
INSERT OR IGNORE INTO permissions (name) VALUES ('admin:tasks');
INSERT OR IGNORE INTO permissions (name) VALUES ('admin:referrals');

INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT r.id, p.name FROM roles r JOIN permissions p ON p.name = 'member:dashboard' WHERE r.name = 'member';

INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT r.id, p.name FROM roles r JOIN permissions p ON p.name IN ('member:dashboard','member:wallet','admin:overview','admin:members','admin:financials','admin:tasks','admin:referrals') WHERE r.name = 'super_admin';

INSERT OR IGNORE INTO packages (name, activation_fee, description)
VALUES ('Bronze', 1000, 'Basic access to opportunities and learning resources.');

INSERT OR IGNORE INTO packages (name, activation_fee, description)
VALUES ('Silver', 1750, 'Expanded access to the member workspace and higher-priority opportunities.');

INSERT OR IGNORE INTO packages (name, activation_fee, description)
VALUES ('Gold', 2500, 'Full access to the platform, advanced tasks, and premium learning features.');

INSERT OR IGNORE INTO opportunities (title, category, description, difficulty, earning_model, requirements, risk_level, featured, status)
VALUES ('Online Transcription', 'Transcription', 'Convert audio or video recordings into written text.', 'Beginner', 'Paid per task or audio minute', 'Good listening skills and attention to detail.', 'Low', 1, 'open');

INSERT OR IGNORE INTO opportunities (title, category, description, difficulty, earning_model, requirements, risk_level, featured, status)
VALUES ('Data Entry Support', 'Data Entry', 'Enter, organize and verify information using online tools.', 'Beginner', 'Paid per task or project', 'Basic computer skills and accuracy.', 'Low', 1, 'open');

INSERT OR IGNORE INTO opportunities (title, category, description, difficulty, earning_model, requirements, risk_level, featured, status)
VALUES ('Research Assistant', 'Research', 'Gather facts, compare sources and summarize findings.', 'Intermediate', 'Paid per task or project', 'Strong research and writing discipline.', 'Low', 0, 'draft');

INSERT OR IGNORE INTO opportunities (title, category, description, difficulty, earning_model, requirements, risk_level, featured, status)
VALUES ('Content Writing', 'Writing', 'Create useful, readable content for clients, businesses, or digital channels.', 'Intermediate', 'Paid per project', 'Writing, grammar, and fact checking ability.', 'Low', 1, 'open');

INSERT OR IGNORE INTO opportunities (title, category, description, difficulty, earning_model, requirements, risk_level, featured, status)
VALUES ('Graphic Design', 'Graphic Design', 'Create digital graphics, social posts and branded creative assets.', 'Intermediate', 'Paid per project', 'Familiarity with design software and visual consistency.', 'Low', 0, 'open');

INSERT OR IGNORE INTO courses (title, slug, description, category, status)
VALUES ('Introduction to Online Freelancing', 'online-freelancing', 'Learn how to build a digital profile, find opportunities, and work safely online.', 'Online freelancing', 'published');

INSERT OR IGNORE INTO courses (title, slug, description, category, status)
VALUES ('Transcription Fundamentals', 'transcription-fundamentals', 'Understand transcription formats, quality control, and client expectations.', 'Transcription', 'published');

INSERT OR IGNORE INTO courses (title, slug, description, category, status)
VALUES ('Data Entry Skills', 'data-entry-skills', 'Build the accuracy and systems thinking needed for online data work.', 'Data entry', 'published');

INSERT OR IGNORE INTO courses (title, slug, description, category, status)
VALUES ('Digital Marketing Essentials', 'digital-marketing-essentials', 'Start with audience research, content strategy, and online growth basics.', 'Digital marketing', 'published');

INSERT OR IGNORE INTO announcements (title, body, is_published)
VALUES ('Platform Update', 'The Online Sphere platform is now using verified member data and secure backend checks for critical transactions.', 1);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_phone ON payment_attempts(phone);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts(status);
