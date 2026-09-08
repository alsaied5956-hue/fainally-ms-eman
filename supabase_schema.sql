-- ========================================================================
-- SUPABASE MIGRATION SCRIPT: Educational Management System (900 Students)
-- Optimized for Real-time Subscriptions, Sub-5ms Barcode Scans & Parent Portal
-- ========================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------------------
-- 1. STUDENTS TABLE
-- ------------------------------------------------------------------------
create table if not exists public.students (
    id uuid primary key default uuid_generate_v4(),
    barcode text not null unique,
    name text not null,
    phone text,
    parent_phone text not null,
    grade text not null,               -- e.g. 'الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي'
    group_days text not null,          -- e.g. 'السبت والثلاثاء', 'الأحد والأربعاء'
    group_time text,                   -- e.g. '04:00 م'
    monthly_fee numeric(10, 2) not null default 0,
    discount numeric(10, 2) not null default 0,
    notes text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Fast lookup indexes for physical barcode scanner & parent portal phone verification
create index if not exists idx_students_barcode on public.students(barcode);
create index if not exists idx_students_parent_phone on public.students(parent_phone);
create index if not exists idx_students_grade on public.students(grade);

-- ------------------------------------------------------------------------
-- 2. ATTENDANCE LOGS TABLE (Zero-Lag Scans)
-- ------------------------------------------------------------------------
create table if not exists public.attendance_logs (
    id uuid primary key default uuid_generate_v4(),
    student_id uuid references public.students(id) on delete cascade,
    barcode text not null,
    student_name text not null,
    date_key text not null,            -- YYYY-MM-DD
    time_recorded timestamptz not null default now(),
    status text not null check (status in ('حضور', 'تأخير', 'غياب')),
    session_slot_id text default 'auto',
    scanned_by text default 'admin',
    notes text,
    created_at timestamptz not null default now(),
    constraint unique_student_session_attendance unique (student_id, date_key)
);

create index if not exists idx_attendance_barcode on public.attendance_logs(barcode);
create index if not exists idx_attendance_student_id on public.attendance_logs(student_id);
create index if not exists idx_attendance_date_key on public.attendance_logs(date_key);
create index if not exists idx_attendance_created_at on public.attendance_logs(created_at desc);

-- ------------------------------------------------------------------------
-- 3. PAYMENTS TABLE (Tuition & Custom Fees)
-- ------------------------------------------------------------------------
create table if not exists public.payments (
    id uuid primary key default uuid_generate_v4(),
    student_id uuid references public.students(id) on delete cascade,
    month_key text not null,           -- YYYY-MM
    amount_paid numeric(10, 2) not null default 0,
    required_amount numeric(10, 2) not null default 0,
    discount numeric(10, 2) not null default 0,
    status text not null check (status in ('paid', 'partial', 'unpaid', 'exempt')),
    payment_date timestamptz not null default now(),
    received_by text default 'admin',
    notes text,
    created_at timestamptz not null default now(),
    constraint unique_student_month_payment unique (student_id, month_key)
);

create index if not exists idx_payments_student_id on public.payments(student_id);
create index if not exists idx_payments_month_key on public.payments(month_key);
create index if not exists idx_payments_status on public.payments(status);

-- ------------------------------------------------------------------------
-- 4. HOMEWORK & EXAMS TABLE
-- ------------------------------------------------------------------------
create table if not exists public.homework (
    id uuid primary key default uuid_generate_v4(),
    student_id uuid references public.students(id) on delete cascade,
    date_key text not null,            -- YYYY-MM-DD
    title text not null,               -- e.g. 'واجب الجبر الدرس الأول'
    status text not null check (status in ('done', 'incomplete', 'not_done', 'exempt')),
    score numeric(5, 2),
    max_score numeric(5, 2),
    notes text,
    created_at timestamptz not null default now()
);

create index if not exists idx_homework_student_id on public.homework(student_id);
create index if not exists idx_homework_date_key on public.homework(date_key);

-- ------------------------------------------------------------------------
-- 5. CHAT MESSAGES (Isolated Parent <-> Admin Portal)
-- ------------------------------------------------------------------------
create table if not exists public.chat_messages (
    id uuid primary key default uuid_generate_v4(),
    student_id uuid references public.students(id) on delete cascade,
    sender_role text not null check (sender_role in ('admin', 'assistant', 'parent')),
    sender_name text not null,
    message text not null,
    is_read boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists idx_chat_student_created on public.chat_messages(student_id, created_at asc);

-- ------------------------------------------------------------------------
-- 6. ENABLE SUPABASE REALTIME REPLICATION (Instant WebSocket Updates)
-- ------------------------------------------------------------------------
alter publication supabase_realtime add table public.students;
alter publication supabase_realtime add table public.attendance_logs;
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.homework;
alter publication supabase_realtime add table public.chat_messages;

-- ------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------
alter table public.students enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.payments enable row level security;
alter table public.homework enable row level security;
alter table public.chat_messages enable row level security;

-- Admin / Staff full access policy (using anon or service key for local/codespace development)
create policy "Admins full access to students"
    on public.students for all
    using (true)
    with check (true);

create policy "Admins full access to attendance_logs"
    on public.attendance_logs for all
    using (true)
    with check (true);

create policy "Admins full access to payments"
    on public.payments for all
    using (true)
    with check (true);

create policy "Admins full access to homework"
    on public.homework for all
    using (true)
    with check (true);

create policy "Admins full access to chat_messages"
    on public.chat_messages for all
    using (true)
    with check (true);

-- Trigger for updating students.updated_at automatically
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create or replace trigger on_student_updated
    before update on public.students
    for each row
    execute function public.handle_updated_at();
