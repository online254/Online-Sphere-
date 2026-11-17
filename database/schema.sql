-- =========================================================
-- ONLINE SPHERE DATABASE
-- EARNING OPPORTUNITIES + MEMBERSHIP + WALLET
-- =========================================================

PRAGMA foreign_keys = ON;

-- =========================================================
-- USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    full_name TEXT NOT NULL,

    email TEXT UNIQUE NOT NULL,

    phone TEXT UNIQUE,

    password_hash TEXT NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- USER ACCOUNTS
-- =========================================================

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL UNIQUE,

    account_number TEXT UNIQUE NOT NULL,

    package TEXT DEFAULT NULL,

    activation_fee INTEGER DEFAULT 0,

    status TEXT DEFAULT 'inactive',

    balance INTEGER DEFAULT 0,

    total_earned INTEGER DEFAULT 0,

    total_withdrawn INTEGER DEFAULT 0,

    pending_withdrawal INTEGER DEFAULT 0,

    currency TEXT DEFAULT 'KES',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- =========================================================
-- MEMBERSHIP PACKAGES
-- =========================================================

CREATE TABLE IF NOT EXISTS packages (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT UNIQUE NOT NULL,

    activation_fee INTEGER NOT NULL,

    description TEXT,

    status TEXT DEFAULT 'active',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- TRANSACTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS transactions (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    account_id INTEGER NOT NULL,

    type TEXT NOT NULL,

    amount INTEGER NOT NULL,

    currency TEXT DEFAULT 'KES',

    status TEXT DEFAULT 'pending',

    reference TEXT UNIQUE,

    description TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE
);


-- =========================================================
-- EARNING OPPORTUNITIES
-- =========================================================

CREATE TABLE IF NOT EXISTS opportunities (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    title TEXT NOT NULL,

    category TEXT NOT NULL,

    description TEXT NOT NULL,

    difficulty TEXT DEFAULT 'Beginner',

    earning_model TEXT,

    requirements TEXT,

    platform_name TEXT,

    external_url TEXT,

    risk_level TEXT DEFAULT 'Low',

    featured INTEGER DEFAULT 0,

    status TEXT DEFAULT 'active',

    payment_amount INTEGER DEFAULT 0,

    payment_currency TEXT DEFAULT 'KES',

    payment_method TEXT DEFAULT 'Wallet credit',

    payment_basis TEXT DEFAULT 'per approved submission',

    positions INTEGER DEFAULT 0,

    application_deadline TEXT,

    start_date TEXT,

    completion_date TEXT,

    image_url TEXT,

    attachment_url TEXT,

    instructions TEXT,

    eligibility TEXT,

    created_by INTEGER,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunity_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    application_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(opportunity_id, user_id),
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS opportunity_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    opportunity_id INTEGER NOT NULL,
    content TEXT,
    attachment_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_at DATETIME,
    reviewed_by INTEGER,
    review_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES opportunity_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS opportunity_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL UNIQUE,
    opportunity_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KES',
    status TEXT NOT NULL DEFAULT 'pending',
    transaction_id INTEGER,
    approved_by INTEGER,
    approved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (submission_id) REFERENCES opportunity_submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);


-- =========================================================
-- SAVED OPPORTUNITIES
-- =========================================================

CREATE TABLE IF NOT EXISTS saved_opportunities (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    opportunity_id INTEGER NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(user_id, opportunity_id),

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (opportunity_id)
        REFERENCES opportunities(id)
        ON DELETE CASCADE
);


-- =========================================================
-- WITHDRAWAL REQUESTS
-- =========================================================

CREATE TABLE IF NOT EXISTS withdrawals (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    account_id INTEGER NOT NULL,

    amount INTEGER NOT NULL,

    method TEXT NOT NULL,

    phone TEXT,

    reference TEXT UNIQUE,

    status TEXT DEFAULT 'pending',

    notes TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    processed_at DATETIME,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE
);


-- =========================================================
-- SESSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS sessions (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    token_hash TEXT NOT NULL,

    expires_at DATETIME NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- =========================================================
-- DEFAULT PACKAGES
-- =========================================================

INSERT OR IGNORE INTO packages
(name, activation_fee, description)
VALUES
(
    'Bronze',
    1000,
    'Basic access to Online Sphere opportunities and learning resources.'
);

INSERT OR IGNORE INTO packages
(name, activation_fee, description)
VALUES
(
    'Silver',
    1750,
    'Expanded access to opportunities and advanced learning resources.'
);

INSERT OR IGNORE INTO packages
(name, activation_fee, description)
VALUES
(
    'Gold',
    2500,
    'Full access to the Online Sphere opportunity and learning library.'
);


-- =========================================================
-- DEFAULT OPPORTUNITIES
-- =========================================================

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'Online Transcription',
    'Transcription',
    'Convert audio or video recordings into written text.',
    'Beginner',
    'Paid per task or audio minute',
    'Good listening skills, typing and attention to detail.',
    'Low',
    1
);

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'Data Entry',
    'Data Entry',
    'Enter, organize and verify information using online tools.',
    'Beginner',
    'Paid per task or project',
    'Basic computer skills and accuracy.',
    'Low',
    1
);

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'Freelancing',
    'Freelancing',
    'Offer professional skills to clients locally or internationally.',
    'Beginner-Advanced',
    'Paid per project or contract',
    'A marketable skill and a professional profile.',
    'Low',
    1
);

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'Academic Writing',
    'Academic Writing',
    'Provide legitimate research and writing assistance while following academic integrity rules.',
    'Intermediate',
    'Paid per project',
    'Strong writing, research and citation skills.',
    'Medium',
    0
);

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'Online Gaming',
    'Gaming',
    'Explore legitimate gaming-related opportunities such as game testing, streaming and content creation.',
    'Beginner',
    'Task, contract, content or platform based',
    'Gaming skills or content creation ability.',
    'Medium',
    0
);

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'Content Creation',
    'Content',
    'Create useful digital content for websites and social platforms.',
    'Beginner-Advanced',
    'Paid per project, contract or platform',
    'Writing, video, design or communication skills.',
    'Low',
    1
);

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'Graphic Design',
    'Design',
    'Create logos, social media graphics, posters and other digital designs.',
    'Intermediate',
    'Paid per project',
    'Design skills and suitable software.',
    'Low',
    0
);

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'AI-Assisted Work',
    'AI',
    'Explore legitimate work involving AI-assisted research, content, data and digital services.',
    'Beginner-Advanced',
    'Paid per task or project',
    'Ability to use AI tools responsibly and verify results.',
    'Medium',
    1
);

INSERT OR IGNORE INTO opportunities
(title, category, description, difficulty, earning_model, requirements, risk_level, featured)
VALUES
(
    'Remote Jobs',
    'Remote Jobs',
    'Find legitimate remote employment and contract opportunities.',
    'Intermediate',
    'Salary, contract or project payment',
    'Skills and qualifications depend on the job.',
    'Low',
    1
);
