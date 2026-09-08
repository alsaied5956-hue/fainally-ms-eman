/**
 * scripts/migrateToSupabase.cjs
 * Comprehensive Migration Script for Educational Management System
 * Imports 728 Students, All Historical & Today Attendance Logs, and Payments into Supabase.
 */

const { createClient } = require("@supabase/supabase-js");
const backupData = require("../src/data/centerBackup.json");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://lzdvmzumwuqycwdecaan.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_B2ATdO71x3VxvOL18ATZtA_bupiDf3l";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function migrateAll() {
  console.log("=================================================");
  console.log("🚀 STARTING FULL SUPABASE DATA MIGRATION");
  console.log("=================================================");

  // -----------------------------------------------------------------
  // 1. MIGRATE STUDENTS
  // -----------------------------------------------------------------
  const students = backupData.students || [];
  console.log(`📦 Step 1: Migrating ${students.length} students...`);

  const studentBatchSize = 100;
  for (let i = 0; i < students.length; i += studentBatchSize) {
    const chunk = students.slice(i, i + studentBatchSize).map((s) => ({
      barcode: String(s.barcode).trim(),
      name: s.name || "طالب بدون اسم",
      phone: String(s.phone || ""),
      parent_phone: String(s.parentPhone || s.phone || "00000000000"),
      grade: s.groupGrade || s.grade || "غير محدد",
      group_days: s.groupDays || "غير محدد",
      group_time: s.groupTime || "04:00 م",
      monthly_fee: Number(s.monthlyFee) || 0,
      discount: Number(s.discount) || 0,
      notes: s.notes || "",
      is_active: s.isActive !== false,
    }));

    const { error } = await supabase.from("students").upsert(chunk, { onConflict: "barcode" });
    if (error) {
      console.error(`❌ Error migrating students batch [${i} - ${i + chunk.length}]:`, error.message);
    } else {
      console.log(`   ✅ Migrated students [${i + 1} to ${Math.min(i + studentBatchSize, students.length)}]`);
    }
  }

  // -----------------------------------------------------------------
  // 2. FETCH ALL INSERTED STUDENTS TO BUILD BARCODE -> ID MAP
  // -----------------------------------------------------------------
  console.log("\n📦 Step 2: Mapping student barcode to generated UUIDs...");
  const barcodeToStudent = new Map();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("students")
      .select("id, barcode, name")
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("Error fetching students map:", error);
      break;
    }
    if (!data || data.length === 0) break;
    data.forEach((s) => barcodeToStudent.set(String(s.barcode).trim(), s));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log(`   ✅ Built student map with ${barcodeToStudent.size} records.`);

  // -----------------------------------------------------------------
  // 3. MIGRATE ATTENDANCE LOGS
  // -----------------------------------------------------------------
  console.log("\n📦 Step 3: Migrating attendance logs (History & Today)...");
  const attendanceLogsToInsert = [];
  const processedKeys = new Set();

  function normalizeStatus(st) {
    if (st === "غائب" || st === "غياب") return "غياب";
    if (st === "تأخير") return "تأخير";
    return "حضور";
  }

  // 3a. History days
  const history = backupData.attendanceHistory || {};
  for (const [dateKey, dayRecords] of Object.entries(history)) {
    if (!dayRecords || typeof dayRecords !== "object") continue;
    for (const [barcode, status] of Object.entries(dayRecords)) {
      const student = barcodeToStudent.get(String(barcode).trim());
      if (!student) continue;

      const uniqueKey = `${student.id}_${dateKey}`;
      if (processedKeys.has(uniqueKey)) continue;
      processedKeys.add(uniqueKey);

      attendanceLogsToInsert.push({
        student_id: student.id,
        barcode: String(barcode).trim(),
        student_name: student.name,
        date_key: dateKey,
        status: normalizeStatus(status),
        time_recorded: new Date(dateKey + "T12:00:00Z").toISOString(),
        session_slot_id: "auto",
        scanned_by: "system_import",
      });
    }
  }

  // 3b. Today attendance
  const todayKey = "2026-09-07";
  const todayAtt = backupData.attendanceToday || {};
  for (const [barcode, status] of Object.entries(todayAtt)) {
    const student = barcodeToStudent.get(String(barcode).trim());
    if (!student) continue;

    const uniqueKey = `${student.id}_${todayKey}`;
    if (processedKeys.has(uniqueKey)) continue;
    processedKeys.add(uniqueKey);

    attendanceLogsToInsert.push({
      student_id: student.id,
      barcode: String(barcode).trim(),
      student_name: student.name,
      date_key: todayKey,
      status: normalizeStatus(status),
      time_recorded: new Date().toISOString(),
      session_slot_id: "auto",
      scanned_by: "system_import",
    });
  }

  console.log(`   Found ${attendanceLogsToInsert.length} attendance logs to insert.`);
  const attBatchSize = 250;
  for (let i = 0; i < attendanceLogsToInsert.length; i += attBatchSize) {
    const chunk = attendanceLogsToInsert.slice(i, i + attBatchSize);
    const { error } = await supabase
      .from("attendance_logs")
      .upsert(chunk, { onConflict: "student_id,date_key" });
    if (error) {
      console.error(`   ❌ Error inserting attendance chunk [${i}]:`, error.message);
    } else {
      console.log(`   ✅ Inserted attendance [${i + 1} to ${Math.min(i + attBatchSize, attendanceLogsToInsert.length)}]`);
    }
  }

  // -----------------------------------------------------------------
  // 4. MIGRATE PAYMENTS
  // -----------------------------------------------------------------
  console.log("\n📦 Step 4: Migrating payment records...");
  const paymentsObj = backupData.payments || {};
  const paymentsToInsert = [];
  const processedPayKeys = new Set();

  for (const [monthKey, monthRecords] of Object.entries(paymentsObj)) {
    if (!monthRecords || typeof monthRecords !== "object") continue;
    for (const [key, rec] of Object.entries(monthRecords)) {
      const barcode = String(rec.barcode || key).trim();
      const student = barcodeToStudent.get(barcode);
      if (!student) continue;

      const mKey = rec.monthKey || rec.month || monthKey;
      const uniquePayKey = `${student.id}_${mKey}`;
      if (processedPayKeys.has(uniquePayKey)) continue;
      processedPayKeys.add(uniquePayKey);

      paymentsToInsert.push({
        student_id: student.id,
        month_key: mKey,
        amount_paid: Number(rec.amount) || 0,
        required_amount: Number(rec.amount) || 100,
        discount: 0,
        status: "paid",
        payment_date: rec.date ? new Date(rec.date + "T12:00:00Z").toISOString() : new Date().toISOString(),
        received_by: rec.recordedBy || "admin",
        notes: rec.note || "سداد اشتراك",
      });
    }
  }

  console.log(`   Found ${paymentsToInsert.length} payments to insert.`);
  const payBatchSize = 200;
  for (let i = 0; i < paymentsToInsert.length; i += payBatchSize) {
    const chunk = paymentsToInsert.slice(i, i + payBatchSize);
    const { error } = await supabase
      .from("payments")
      .upsert(chunk, { onConflict: "student_id,month_key" });
    if (error) {
      console.error(`   ❌ Error inserting payments chunk [${i}]:`, error.message);
    } else {
      console.log(`   ✅ Inserted payments [${i + 1} to ${Math.min(i + payBatchSize, paymentsToInsert.length)}]`);
    }
  }

  console.log("\n=================================================");
  console.log("🎉 FULL MIGRATION SUCCESSFULLY COMPLETED!");
  console.log("=================================================");
}

migrateAll().catch((err) => {
  console.error("Fatal migration error:", err);
  process.exit(1);
});
