// seed.js — run with `npm run seed`
// Populates safe, local-only demo data. Passwords below are for LOCAL
// DEVELOPMENT ONLY — never reuse these in any deployed environment.
import { db, resetDatabaseForTests } from './src/db.js';
import { newId } from './src/lib/ids.js';
import { registerUser } from './src/lib/auth.js';
import { createPendingReward, confirmReward, requestWithdrawal } from './src/lib/ledger.js';
import { evaluateResponse } from './src/lib/fraud.js';

console.log('Resetting local demo database...');
resetDatabaseForTests();

function makeParticipant({ full_name, email, city, age_range, gender, occupation, interests }) {
  const userId = registerUser({ email, password: 'Password123!', role: 'USER', full_name });
  db.prepare(`INSERT INTO profiles (user_id, age_range, gender, city, area, occupation_category) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, age_range, gender, city, null, occupation);
  for (const tag of interests) db.prepare('INSERT INTO user_interests (id, user_id, tag) VALUES (?, ?, ?)').run(newId(), userId, tag);
  db.prepare('INSERT INTO wallets (id, user_id) VALUES (?, ?)').run(newId(), userId);
  return userId;
}

// --- Admin ---
const adminId = registerUser({ email: 'admin@insightloop.dev', password: 'AdminPass123!', role: 'ADMIN', full_name: 'Platform Admin' });
console.log('Created admin: admin@insightloop.dev / AdminPass123!');

// --- Businesses ---
const biz1Owner = registerUser({ email: 'cafe@business.dev', password: 'BizPass123!', role: 'BUSINESS', full_name: 'Ravi Kumar' });
const biz1Id = newId();
db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, gstin, verification_status, city, category) VALUES (?, ?, ?, ?, 'VERIFIED', ?, ?)`)
  .run(biz1Id, biz1Owner, 'Campus Corner Cafe', '37AAAAA0000A1Z5', 'Visakhapatnam', 'food_beverage');
db.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES (?, ?, ?, 'OWNER')`).run(newId(), biz1Id, biz1Owner);
console.log('Created business (VERIFIED): cafe@business.dev / BizPass123!');

const biz2Owner = registerUser({ email: 'retail@business.dev', password: 'BizPass123!', role: 'BUSINESS', full_name: 'Priya Nair' });
const biz2Id = newId();
db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, gstin, verification_status, city, category) VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`)
  .run(biz2Id, biz2Owner, 'Nair Retail Ventures', null, 'Visakhapatnam', 'retail');
db.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES (?, ?, ?, 'OWNER')`).run(newId(), biz2Id, biz2Owner);
console.log('Created business (PENDING verification): retail@business.dev / BizPass123!');

// --- Participants (mixed profiles so matching / eligibility is demonstrable) ---
const participants = [
  makeParticipant({ full_name: 'Ananya Reddy', email: 'ananya@participant.dev', city: 'Visakhapatnam', age_range: '18-25', gender: 'female', occupation: 'student', interests: ['food', 'students', 'smartphones'] }),
  makeParticipant({ full_name: 'Rahul Verma', email: 'rahul@participant.dev', city: 'Visakhapatnam', age_range: '18-25', gender: 'male', occupation: 'student', interests: ['food', 'students'] }),
  makeParticipant({ full_name: 'Sneha Iyer', email: 'sneha@participant.dev', city: 'Visakhapatnam', age_range: '26-35', gender: 'female', occupation: 'salaried', interests: ['food', 'shopping'] }),
  makeParticipant({ full_name: 'Kiran Rao', email: 'kiran@participant.dev', city: 'Visakhapatnam', age_range: '26-35', gender: 'male', occupation: 'self_employed', interests: ['smartphones', 'gadgets'] }),
  makeParticipant({ full_name: 'Divya Menon', email: 'divya@participant.dev', city: 'Hyderabad', age_range: '18-25', gender: 'female', occupation: 'student', interests: ['food', 'students'] }), // different city - good for showing eligibility filtering
  makeParticipant({ full_name: 'Arjun Das', email: 'arjun@participant.dev', city: 'Visakhapatnam', age_range: '46-60', gender: 'male', occupation: 'other', interests: ['food'] }), // outside target age range for demo study
];
console.log('Created 6 demo participants, all password: Password123!');

// --- Study 1: ACTIVE pricing test from Campus Corner Cafe, with real responses ---
const study1Id = newId();
db.prepare(`
  INSERT INTO research_projects
    (id, business_id, title, template_type, objective, target_city, target_min_age, target_max_age, target_gender, target_tags, sample_size, budget_paise, reward_per_response_paise, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
`).run(study1Id, biz1Id, 'Would students buy a ₹199 lunch combo?', 'pricing_test',
  'I am opening a cafe near a college and want to know what students want.',
  'Visakhapatnam', 18, 30, 'any', JSON.stringify(['food', 'students']), 100, 65000, 500);

const q1 = newId(); const q2 = newId(); const q3 = newId();
db.prepare(`INSERT INTO survey_questions (id, research_project_id, order_index, question_text, question_type, is_required) VALUES (?, ?, 0, ?, 'yes_no', 1)`)
  .run(q1, study1Id, 'Would you consider buying a ₹199 lunch combo near your college?');
const q1yes = newId(); const q1no = newId();
db.prepare('INSERT INTO question_options (id, question_id, option_text, order_index) VALUES (?, ?, ?, 0)').run(q1yes, q1, 'Yes');
db.prepare('INSERT INTO question_options (id, question_id, option_text, order_index) VALUES (?, ?, ?, 1)').run(q1no, q1, 'No');

db.prepare(`INSERT INTO survey_questions (id, research_project_id, order_index, question_text, question_type, is_required) VALUES (?, ?, 1, ?, 'single_choice', 1)`)
  .run(q2, study1Id, 'What time would you most likely eat lunch?');
const q2opts = ['11 AM - 12 PM', '12 PM - 2 PM', '2 PM - 4 PM'].map((t, i) => {
  const id = newId();
  db.prepare('INSERT INTO question_options (id, question_id, option_text, order_index) VALUES (?, ?, ?, ?)').run(id, q2, t, i);
  return id;
});

db.prepare(`INSERT INTO survey_questions (id, research_project_id, order_index, question_text, question_type, is_required) VALUES (?, ?, 2, ?, 'rating_5', 1)`)
  .run(q3, study1Id, 'How important is price vs portion size to you? (1=price matters most, 5=portion size matters most)');

// Simulate 4 eligible participants responding: 3 clean, 1 flagged (too fast)
function simulateResponse(userId, { durationSeconds, q1Choice, q2Choice, q3Rating, deviceFingerprint }) {
  const responseId = newId();
  db.prepare(`
    INSERT INTO survey_responses (id, research_project_id, user_id, completed_at, duration_seconds, device_fingerprint, status)
    VALUES (?, ?, ?, datetime('now'), ?, ?, 'PENDING')
  `).run(responseId, study1Id, userId, durationSeconds, deviceFingerprint || `seed-device-${userId.slice(0, 8)}`);

  db.prepare(`INSERT INTO answers (id, response_id, question_id, selected_option_ids) VALUES (?, ?, ?, ?)`)
    .run(newId(), responseId, q1, JSON.stringify([q1Choice]));
  db.prepare(`INSERT INTO answers (id, response_id, question_id, selected_option_ids) VALUES (?, ?, ?, ?)`)
    .run(newId(), responseId, q2, JSON.stringify([q2Choice]));
  db.prepare(`INSERT INTO answers (id, response_id, question_id, rating_value) VALUES (?, ?, ?, ?)`)
    .run(newId(), responseId, q3, q3Rating);

  const evalResult = evaluateResponse({
    userId, researchProjectId: study1Id, durationSeconds, questionCount: 3,
    answers: [{ rating_value: q3Rating }], deviceFingerprint: deviceFingerprint || `seed-device-${userId.slice(0, 8)}`,
  });
  db.prepare('UPDATE survey_responses SET status = ?, quality_score = ? WHERE id = ?').run(evalResult.status, evalResult.qualityScore, responseId);

  if (evalResult.status === 'FLAGGED') {
    db.prepare(`INSERT INTO response_quality (id, response_id, flag_reasons) VALUES (?, ?, ?)`).run(newId(), responseId, JSON.stringify(evalResult.reasons));
    db.prepare(`INSERT INTO fraud_flags (id, entity_type, entity_id, reason, severity) VALUES (?, 'RESPONSE', ?, ?, 'MEDIUM')`).run(newId(), responseId, evalResult.reasons.join('; '));
  }
  createPendingReward({ userId, responseId, amountPaise: 500 });
  if (evalResult.status === 'VALID') confirmReward(responseId);
  return { responseId, status: evalResult.status };
}

const r1 = simulateResponse(participants[0], { durationSeconds: 45, q1Choice: q1yes, q2Choice: q2opts[1], q3Rating: 4 });
const r2 = simulateResponse(participants[1], { durationSeconds: 38, q1Choice: q1yes, q2Choice: q2opts[1], q3Rating: 3 });
const r3 = simulateResponse(participants[2], { durationSeconds: 52, q1Choice: q1no, q2Choice: q2opts[0], q3Rating: 2 });
const r4 = simulateResponse(participants[3], { durationSeconds: 4, q1Choice: q1yes, q2Choice: q2opts[2], q3Rating: 5 }); // too fast -> FLAGGED
console.log('Simulated 4 responses to Study 1:', [r1, r2, r3, r4].map(r => r.status).join(', '));

// --- Study 2: SUBMITTED, awaiting admin approval (so the admin demo has something to approve) ---
const study2Id = newId();
db.prepare(`
  INSERT INTO research_projects
    (id, business_id, title, template_type, objective, target_city, target_min_age, target_max_age, target_gender, target_tags, sample_size, budget_paise, reward_per_response_paise, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED')
`).run(study2Id, biz1Id, 'Coffee vs tea preference among regulars', 'feature_preference',
  'Deciding whether to expand our tea menu.', 'Visakhapatnam', 18, 45, 'any', JSON.stringify(['food']), 50, 32500, 500);
const q2_1 = newId();
db.prepare(`INSERT INTO survey_questions (id, research_project_id, order_index, question_text, question_type, is_required) VALUES (?, ?, 0, ?, 'single_choice', 1)`)
  .run(q2_1, study2Id, 'Which do you drink more often?');
['Coffee', 'Tea', 'Both equally'].forEach((t, i) => {
  db.prepare('INSERT INTO question_options (id, question_id, option_text, order_index) VALUES (?, ?, ?, ?)').run(newId(), q2_1, t, i);
});
db.prepare(`INSERT INTO business_payments (id, business_id, research_project_id, amount_paise, status) VALUES (?, ?, ?, ?, 'MANUAL_PENDING')`)
  .run(newId(), biz1Id, study2Id, 32500);
console.log('Created Study 2 (SUBMITTED, awaiting admin approval)');

// --- A pending withdrawal request, so the admin demo has something to process ---
requestWithdrawal({ userId: participants[0], amountPaise: 500, upiId: 'ananya@upi' });
console.log('Created a pending withdrawal request for Ananya Reddy');

console.log('\nSeed complete. Demo credentials:');
console.log('  Admin:                admin@insightloop.dev / AdminPass123!');
console.log('  Business (verified):  cafe@business.dev / BizPass123!');
console.log('  Business (pending):   retail@business.dev / BizPass123!');
console.log('  Participants:         ananya@participant.dev, rahul@participant.dev, sneha@participant.dev,');
console.log('                        kiran@participant.dev, divya@participant.dev, arjun@participant.dev');
console.log('                        (all passwords: Password123!)');
