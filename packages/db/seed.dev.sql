-- Development seed: a realistic roster of verified professionals across all
-- categories. Profiles are generated (not scraped — no real people), but
-- affiliations and areas are real Nairobi institutions so the marketplace
-- reads true. Idempotent via ON CONFLICT on whatsapp_e164.

INSERT INTO professionals (
  display_name, whatsapp_e164, email, preferred_channel,
  calcom_user_id, calcom_event_type, payout_method, fee_percent,
  verification_status, category, affiliation, title, bio, location_area
) VALUES
  -- ---------- Doctors ----------
  ('Dr. Amara Okonkwo', '+254712000001', 'amara@example.com', 'WHATSAPP',
   1, 101, '{"type":"MPESA","msisdn":"+254712000001"}', 15.00,
   'VERIFIED', 'DOCTOR', 'Kenyatta National Hospital', 'Consultant Paediatrician',
   'Fifteen years in paediatric care. Available for second opinions and urgent consultations.', 'Upper Hill, Nairobi'),
  ('Dr. Sarah Chen', '+254712000002', 'sarah@example.com', 'WHATSAPP',
   2, 102, '{"type":"MPESA","msisdn":"+254712000002"}', 15.00,
   'VERIFIED', 'DOCTOR', 'Aga Khan University Hospital', 'Cardiologist',
   'Interventional cardiologist. Consultations on heart health, ECG reviews, and referrals.', 'Parklands, Nairobi'),
  ('Dr. Brian Kiptoo', '+254712000003', 'brian@example.com', 'WHATSAPP',
   3, 103, '{"type":"MPESA","msisdn":"+254712000003"}', 15.00,
   'VERIFIED', 'DOCTOR', 'The Nairobi Hospital', 'General Practitioner',
   'Family medicine and preventive care. Quick turnaround on lab result reviews.', 'CBD, Nairobi'),
  ('Dr. Halima Abdi', '+254712000011', 'halima@example.com', 'WHATSAPP',
   11, 111, '{"type":"MPESA","msisdn":"+254712000011"}', 15.00,
   'VERIFIED', 'DOCTOR', 'MP Shah Hospital', 'Obstetrician-Gynaecologist',
   'Antenatal consultations, fertility guidance, and gynaecological second opinions.', 'Parklands, Nairobi'),
  ('Dr. Samuel Njoroge', '+254712000012', 'samuel@example.com', 'WHATSAPP',
   12, 112, '{"type":"MPESA","msisdn":"+254712000012"}', 15.00,
   'VERIFIED', 'DOCTOR', 'Mater Misericordiae Hospital', 'Orthopaedic Surgeon',
   'Sports injuries, fracture follow-ups, and surgical opinion reviews.', 'South B, Nairobi'),
  ('Dr. Lucy Wambui', '+254712000013', 'lucy@example.com', 'WHATSAPP',
   13, 113, '{"type":"MPESA","msisdn":"+254712000013"}', 15.00,
   'VERIFIED', 'DOCTOR', 'Gertrude''s Children''s Hospital', 'Paediatric Dermatologist',
   'Childhood skin conditions, eczema management plans, and photo reviews.', 'Muthaiga, Nairobi'),

  -- ---------- Lecturers ----------
  ('Prof. James Mutua', '+254712000004', 'james@example.com', 'WHATSAPP',
   4, 104, '{"type":"MPESA","msisdn":"+254712000004"}', 12.50,
   'VERIFIED', 'LECTURER', 'University of Nairobi', 'Professor of Economics',
   'Supervises graduate research. Available for thesis reviews and economics tutoring.', 'CBD, Nairobi'),
  ('Dr. Grace Wanjiru', '+254712000005', 'grace@example.com', 'WHATSAPP',
   5, 105, '{"type":"MPESA","msisdn":"+254712000005"}', 12.50,
   'VERIFIED', 'LECTURER', 'Strathmore University', 'Senior Lecturer, Computer Science',
   'Teaches distributed systems and machine learning. Mentors final-year projects.', 'Madaraka, Nairobi'),
  ('Dr. Peter Omondi', '+254712000006', 'peter@example.com', 'WHATSAPP',
   6, 106, '{"type":"MPESA","msisdn":"+254712000006"}', 12.50,
   'VERIFIED', 'LECTURER', 'Kenyatta University', 'Lecturer, Applied Mathematics',
   'Calculus, statistics, and exam preparation for university students.', 'Kahawa, Nairobi'),
  ('Prof. Esther Kamau', '+254712000021', 'esther@example.com', 'WHATSAPP',
   21, 121, '{"type":"MPESA","msisdn":"+254712000021"}', 12.50,
   'VERIFIED', 'LECTURER', 'Jomo Kenyatta University of Agriculture and Technology', 'Professor of Civil Engineering',
   'Structural design reviews, research supervision, and PE exam preparation.', 'Juja, Kiambu'),
  ('Dr. David Otieno', '+254712000022', 'david@example.com', 'WHATSAPP',
   22, 122, '{"type":"MPESA","msisdn":"+254712000022"}', 12.50,
   'VERIFIED', 'LECTURER', 'University of Nairobi', 'Senior Lecturer, School of Law',
   'Constitutional law tutoring, moot court coaching, and LLB dissertation guidance.', 'Parklands, Nairobi'),
  ('Dr. Mercy Chebet', '+254712000023', 'mercy@example.com', 'WHATSAPP',
   23, 123, '{"type":"MPESA","msisdn":"+254712000023"}', 12.50,
   'VERIFIED', 'LECTURER', 'Strathmore Business School', 'Lecturer, Finance & Accounting',
   'CFA and CPA exam coaching, corporate finance tutorials, and case-study prep.', 'Madaraka, Nairobi'),
  ('Prof. Anthony Mwangi', '+254712000024', 'anthony@example.com', 'WHATSAPP',
   24, 124, '{"type":"MPESA","msisdn":"+254712000024"}', 12.50,
   'VERIFIED', 'LECTURER', 'Kenyatta University', 'Professor of Education',
   'Curriculum development, research methods, and postgraduate supervision.', 'Kahawa, Nairobi'),
  ('Dr. Naomi Akinyi', '+254712000025', 'naomi@example.com', 'WHATSAPP',
   25, 125, '{"type":"MPESA","msisdn":"+254712000025"}', 12.50,
   'VERIFIED', 'LECTURER', 'United States International University - Africa', 'Lecturer, Psychology',
   'Research design clinics, SPSS/statistics help, and thesis defence preparation.', 'Kasarani, Nairobi'),
  ('Dr. Felix Mureithi', '+254712000026', 'felix@example.com', 'WHATSAPP',
   26, 126, '{"type":"MPESA","msisdn":"+254712000026"}', 12.50,
   'VERIFIED', 'LECTURER', 'Multimedia University of Kenya', 'Senior Lecturer, Software Engineering',
   'Code reviews for student projects, data structures tutoring, and interview prep.', 'Rongai, Kajiado'),

  -- ---------- Lawyers ----------
  ('Kevin Otieno, Adv.', '+254712000008', 'kevin@example.com', 'WHATSAPP',
   8, 108, '{"type":"MPESA","msisdn":"+254712000008"}', 15.00,
   'VERIFIED', 'LAWYER', 'Otieno Law Chambers', 'Advocate of the High Court',
   'Contract review, land matters, and employment law consultations.', 'Kilimani, Nairobi'),
  ('Wanjiru Kariuki, Adv.', '+254712000031', 'wanjiru@example.com', 'WHATSAPP',
   31, 131, '{"type":"MPESA","msisdn":"+254712000031"}', 15.00,
   'VERIFIED', 'LAWYER', 'Kariuki & Partners Advocates', 'Family Law Specialist',
   'Divorce, custody, and succession matters handled with discretion.', 'Westlands, Nairobi'),
  ('Hassan Yusuf, Adv.', '+254712000032', 'hassan@example.com', 'WHATSAPP',
   32, 132, '{"type":"MPESA","msisdn":"+254712000032"}', 15.00,
   'VERIFIED', 'LAWYER', 'Yusuf Legal Consultancy', 'Commercial & Startup Counsel',
   'Company registration, shareholder agreements, and fundraising paperwork.', 'Upper Hill, Nairobi'),

  -- ---------- Accountants ----------
  ('Faith Njeri, CPA', '+254712000007', 'faith@example.com', 'WHATSAPP',
   7, 107, '{"type":"MPESA","msisdn":"+254712000007"}', 15.00,
   'VERIFIED', 'ACCOUNTANT', 'Njeri & Associates', 'Certified Public Accountant',
   'Tax filing, KRA compliance, and small-business bookkeeping advice.', 'Westlands, Nairobi'),
  ('John Baraza, CPA', '+254712000041', 'baraza@example.com', 'WHATSAPP',
   41, 141, '{"type":"MPESA","msisdn":"+254712000041"}', 15.00,
   'VERIFIED', 'ACCOUNTANT', 'Baraza Audit & Advisory', 'Audit Partner',
   'Statutory audits, forensic reviews, and audit-readiness checks for SMEs.', 'CBD, Nairobi'),
  ('Rose Adhiambo, CPA', '+254712000042', 'rose@example.com', 'WHATSAPP',
   42, 142, '{"type":"MPESA","msisdn":"+254712000042"}', 15.00,
   'VERIFIED', 'ACCOUNTANT', 'Adhiambo Tax Consultants', 'Tax Advisor',
   'Personal and corporate tax planning, VAT returns, and KRA dispute support.', 'Kilimani, Nairobi'),

  -- ---------- Engineers ----------
  ('Eng. Michael Waweru', '+254712000051', 'waweru@example.com', 'WHATSAPP',
   51, 151, '{"type":"MPESA","msisdn":"+254712000051"}', 15.00,
   'VERIFIED', 'ENGINEER', 'Waweru Structural Consultants', 'Registered Structural Engineer',
   'House plan reviews, structural inspections, and construction supervision advice.', 'Karen, Nairobi'),
  ('Eng. Beatrice Moraa', '+254712000052', 'moraa@example.com', 'WHATSAPP',
   52, 152, '{"type":"MPESA","msisdn":"+254712000052"}', 15.00,
   'VERIFIED', 'ENGINEER', 'Moraa Electrical Solutions', 'Licensed Electrical Engineer',
   'Solar sizing, wiring compliance checks, and EPRA licensing guidance.', 'Embakasi, Nairobi'),

  -- ---------- Therapists ----------
  ('Joy Muthoni', '+254712000061', 'joy@example.com', 'WHATSAPP',
   61, 161, '{"type":"MPESA","msisdn":"+254712000061"}', 15.00,
   'VERIFIED', 'THERAPIST', 'Chiromo Hospital Group', 'Clinical Psychologist',
   'Anxiety, burnout, and grief counselling. Evening sessions available.', 'Westlands, Nairobi'),
  ('Daniel Kimani', '+254712000062', 'daniel@example.com', 'WHATSAPP',
   62, 162, '{"type":"MPESA","msisdn":"+254712000062"}', 15.00,
   'VERIFIED', 'THERAPIST', 'Amani Counselling Centre', 'Marriage & Family Therapist',
   'Couples counselling and family mediation, in person or over video.', 'South C, Nairobi')
ON CONFLICT (whatsapp_e164) DO UPDATE SET
  category = EXCLUDED.category,
  affiliation = EXCLUDED.affiliation,
  title = EXCLUDED.title,
  bio = EXCLUDED.bio,
  verification_status = EXCLUDED.verification_status,
  location_area = EXCLUDED.location_area;

-- Everyone in the seed is listed and bookable.
UPDATE professionals SET is_active = true, is_available = true
WHERE whatsapp_e164 LIKE '+2547120000%';

-- ---------- Example unverified applications ----------
-- Fictional examples (generated, not scraped — no real people) of the
-- "apply for a professional account" self-service flow: someone submits
-- their details and lands in PENDING_VERIFICATION until an admin runs them
-- through the registry+OTP pipeline. claim_status is UNCLAIMED (not
-- FULLY_ACTIVATED) because, unlike the self-application endpoint, these
-- fixtures have no real AuthKit account behind them. They stay invisible on
-- the public listing (which requires verification_status = 'VERIFIED') and
-- exist only to populate the admin review queue and demonstrate the claim
-- flow with realistic-looking, clearly-labelled placeholder data. Five per
-- category, across different institutions, as requested.

INSERT INTO professionals (
  display_name, whatsapp_e164, email, preferred_channel,
  calcom_user_id, calcom_event_type, payout_method, fee_percent,
  verification_status, claim_status, category, affiliation, title, bio, location_area
) VALUES
  -- ---------- Doctors (unverified example applications) ----------
  ('Dr. Caroline Njuguna', '+254712000201', 'caroline.njuguna.example@example.com', 'WHATSAPP',
   201, 201, '{"type":"MPESA","msisdn":"+254712000201"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'DOCTOR', 'Moi Teaching and Referral Hospital', 'General Practitioner',
   'Example application — not yet verified. Family medicine and outpatient consultations.', 'Eldoret'),
  ('Dr. Patrick Kiplangat', '+254712000202', 'patrick.kiplangat.example@example.com', 'WHATSAPP',
   202, 202, '{"type":"MPESA","msisdn":"+254712000202"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'DOCTOR', 'Coast General Teaching and Referral Hospital', 'Internist',
   'Example application — not yet verified. Chronic disease management and second opinions.', 'Mombasa'),
  ('Dr. Winnie Auma', '+254712000203', 'winnie.auma.example@example.com', 'WHATSAPP',
   203, 203, '{"type":"MPESA","msisdn":"+254712000203"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'DOCTOR', 'Jaramogi Oginga Odinga Teaching and Referral Hospital', 'Dermatologist',
   'Example application — not yet verified. Skin condition consultations and photo reviews.', 'Kisumu'),
  ('Dr. Abdirahman Noor', '+254712000204', 'abdirahman.noor.example@example.com', 'WHATSAPP',
   204, 204, '{"type":"MPESA","msisdn":"+254712000204"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'DOCTOR', 'Nakuru Level 5 Hospital', 'Emergency Medicine Physician',
   'Example application — not yet verified. Urgent-care triage and referral guidance.', 'Nakuru'),
  ('Dr. Purity Wangeci', '+254712000205', 'purity.wangeci.example@example.com', 'WHATSAPP',
   205, 205, '{"type":"MPESA","msisdn":"+254712000205"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'DOCTOR', 'Nyeri County Referral Hospital', 'Paediatrician',
   'Example application — not yet verified. Newborn checkups and vaccination guidance.', 'Nyeri'),

  -- ---------- Lecturers (unverified example applications) ----------
  ('Dr. Elijah Simiyu', '+254712000211', 'elijah.simiyu.example@example.com', 'WHATSAPP',
   211, 211, '{"type":"MPESA","msisdn":"+254712000211"}', 12.50,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LECTURER', 'Moi University', 'Lecturer, Computer Science',
   'Example application — not yet verified. Algorithms tutoring and capstone supervision.', 'Eldoret'),
  ('Prof. Consolata Wafula', '+254712000212', 'consolata.wafula.example@example.com', 'WHATSAPP',
   212, 212, '{"type":"MPESA","msisdn":"+254712000212"}', 12.50,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LECTURER', 'Egerton University', 'Professor of Agricultural Economics',
   'Example application — not yet verified. Research methods coaching and thesis reviews.', 'Nakuru'),
  ('Dr. Titus Barasa', '+254712000213', 'titus.barasa.example@example.com', 'WHATSAPP',
   213, 213, '{"type":"MPESA","msisdn":"+254712000213"}', 12.50,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LECTURER', 'Technical University of Kenya', 'Senior Lecturer, Mechanical Engineering',
   'Example application — not yet verified. Design-project reviews and exam preparation.', 'CBD, Nairobi'),
  ('Dr. Immaculate Nafula', '+254712000214', 'immaculate.nafula.example@example.com', 'WHATSAPP',
   214, 214, '{"type":"MPESA","msisdn":"+254712000214"}', 12.50,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LECTURER', 'Maseno University', 'Lecturer, Public Health',
   'Example application — not yet verified. Biostatistics tutoring and dissertation guidance.', 'Kisumu'),
  ('Prof. Boniface Kilonzo', '+254712000215', 'boniface.kilonzo.example@example.com', 'WHATSAPP',
   215, 215, '{"type":"MPESA","msisdn":"+254712000215"}', 12.50,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LECTURER', 'South Eastern Kenya University', 'Professor of Land Law',
   'Example application — not yet verified. Property law tutoring and moot court coaching.', 'Kitui'),

  -- ---------- Lawyers (unverified example applications) ----------
  ('Miriam Chepkoech, Adv.', '+254712000221', 'miriam.chepkoech.example@example.com', 'WHATSAPP',
   221, 221, '{"type":"MPESA","msisdn":"+254712000221"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LAWYER', 'Chepkoech & Co. Advocates', 'Conveyancing Specialist',
   'Example application — not yet verified. Land transfer and title search guidance.', 'Eldoret'),
  ('Omar Sheikh, Adv.', '+254712000222', 'omar.sheikh.example@example.com', 'WHATSAPP',
   222, 222, '{"type":"MPESA","msisdn":"+254712000222"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LAWYER', 'Sheikh Maritime Legal Associates', 'Maritime & Shipping Counsel',
   'Example application — not yet verified. Cargo disputes and port-authority matters.', 'Mombasa'),
  ('Beatrice Oyugi, Adv.', '+254712000223', 'beatrice.oyugi.example@example.com', 'WHATSAPP',
   223, 223, '{"type":"MPESA","msisdn":"+254712000223"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LAWYER', 'Oyugi Dispute Resolution Chambers', 'Arbitration & Mediation',
   'Example application — not yet verified. Commercial dispute mediation.', 'Kisumu'),
  ('Collins Mutinda, Adv.', '+254712000224', 'collins.mutinda.example@example.com', 'WHATSAPP',
   224, 224, '{"type":"MPESA","msisdn":"+254712000224"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LAWYER', 'Mutinda & Associates', 'Labour Law Specialist',
   'Example application — not yet verified. Unfair-dismissal and CBA consultations.', 'Nakuru'),
  ('Zainab Hassan, Adv.', '+254712000225', 'zainab.hassan.example@example.com', 'WHATSAPP',
   225, 225, '{"type":"MPESA","msisdn":"+254712000225"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'LAWYER', 'Hassan Immigration Law Office', 'Immigration Counsel',
   'Example application — not yet verified. Work-permit and residency applications.', 'Nyeri'),

  -- ---------- Accountants (unverified example applications) ----------
  ('Douglas Kiprono, CPA', '+254712000231', 'douglas.kiprono.example@example.com', 'WHATSAPP',
   231, 231, '{"type":"MPESA","msisdn":"+254712000231"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ACCOUNTANT', 'Kiprono Tax & Audit Services', 'Tax Consultant',
   'Example application — not yet verified. PAYE and turnover-tax guidance for SMEs.', 'Eldoret'),
  ('Sylvia Mumbi, CPA', '+254712000232', 'sylvia.mumbi.example@example.com', 'WHATSAPP',
   232, 232, '{"type":"MPESA","msisdn":"+254712000232"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ACCOUNTANT', 'Mumbi Bookkeeping Partners', 'Bookkeeping Advisor',
   'Example application — not yet verified. Monthly reconciliation and payroll setup.', 'Mombasa'),
  ('Erick Onyango, CPA', '+254712000233', 'erick.onyango.example@example.com', 'WHATSAPP',
   233, 233, '{"type":"MPESA","msisdn":"+254712000233"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ACCOUNTANT', 'Onyango Forensic Accounting', 'Forensic Accountant',
   'Example application — not yet verified. Fraud-risk reviews and internal-control audits.', 'Kisumu'),
  ('Agnes Wairimu, CPA', '+254712000234', 'agnes.wairimu.example@example.com', 'WHATSAPP',
   234, 234, '{"type":"MPESA","msisdn":"+254712000234"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ACCOUNTANT', 'Wairimu Payroll Solutions', 'Payroll Specialist',
   'Example application — not yet verified. NSSF/NHIF compliance and payroll audits.', 'Nakuru'),
  ('Ibrahim Mohamed, CPA', '+254712000235', 'ibrahim.mohamed.example@example.com', 'WHATSAPP',
   235, 235, '{"type":"MPESA","msisdn":"+254712000235"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ACCOUNTANT', 'Mohamed Chartered Accountants', 'Chartered Accountant',
   'Example application — not yet verified. Statutory accounts and KRA audit support.', 'Garissa'),

  -- ---------- Engineers (unverified example applications) ----------
  ('Eng. Faith Chelagat', '+254712000241', 'faith.chelagat.example@example.com', 'WHATSAPP',
   241, 241, '{"type":"MPESA","msisdn":"+254712000241"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ENGINEER', 'Chelagat Civil Works', 'Civil Engineer',
   'Example application — not yet verified. Site-plan reviews and drainage assessments.', 'Eldoret'),
  ('Eng. Hassan Athman', '+254712000242', 'hassan.athman.example@example.com', 'WHATSAPP',
   242, 242, '{"type":"MPESA","msisdn":"+254712000242"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ENGINEER', 'Athman Marine Engineering', 'Marine Engineer',
   'Example application — not yet verified. Vessel-inspection and machinery consultations.', 'Mombasa'),
  ('Eng. Lilian Achieng', '+254712000243', 'lilian.achieng.example@example.com', 'WHATSAPP',
   243, 243, '{"type":"MPESA","msisdn":"+254712000243"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ENGINEER', 'Achieng Water Systems', 'Water & Sanitation Engineer',
   'Example application — not yet verified. Borehole design and water-quality reviews.', 'Kisumu'),
  ('Eng. Peter Kamotho', '+254712000244', 'peter.kamotho.example@example.com', 'WHATSAPP',
   244, 244, '{"type":"MPESA","msisdn":"+254712000244"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ENGINEER', 'Kamotho Structural Consultants', 'Structural Engineer',
   'Example application — not yet verified. Building-plan approvals and inspections.', 'Nakuru'),
  ('Eng. Susan Gathoni', '+254712000245', 'susan.gathoni.example@example.com', 'WHATSAPP',
   245, 245, '{"type":"MPESA","msisdn":"+254712000245"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'ENGINEER', 'Gathoni Renewable Energy', 'Renewable Energy Engineer',
   'Example application — not yet verified. Solar-system sizing and EPRA compliance.', 'Nyeri'),

  -- ---------- Therapists (unverified example applications) ----------
  ('Grace Nafula', '+254712000251', 'grace.nafula.example@example.com', 'WHATSAPP',
   251, 251, '{"type":"MPESA","msisdn":"+254712000251"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'THERAPIST', 'Eldoret Wellness Centre', 'Clinical Psychologist',
   'Example application — not yet verified. Trauma-focused counselling.', 'Eldoret'),
  ('Kelvin Otiende', '+254712000252', 'kelvin.otiende.example@example.com', 'WHATSAPP',
   252, 252, '{"type":"MPESA","msisdn":"+254712000252"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'THERAPIST', 'Coastal Mind Care', 'Substance Use Counsellor',
   'Example application — not yet verified. Addiction recovery support sessions.', 'Mombasa'),
  ('Nancy Achola', '+254712000253', 'nancy.achola.example@example.com', 'WHATSAPP',
   253, 253, '{"type":"MPESA","msisdn":"+254712000253"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'THERAPIST', 'Lakeview Counselling Centre', 'Child & Adolescent Therapist',
   'Example application — not yet verified. School-related anxiety and behaviour support.', 'Kisumu'),
  ('Martin Kiptui', '+254712000254', 'martin.kiptui.example@example.com', 'WHATSAPP',
   254, 254, '{"type":"MPESA","msisdn":"+254712000254"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'THERAPIST', 'Nakuru Mindful Living Practice', 'Cognitive Behavioural Therapist',
   'Example application — not yet verified. CBT-based anxiety and stress management.', 'Nakuru'),
  ('Esther Wanjiku', '+254712000255', 'esther.wanjiku.example@example.com', 'WHATSAPP',
   255, 255, '{"type":"MPESA","msisdn":"+254712000255"}', 15.00,
   'PENDING_VERIFICATION', 'UNCLAIMED', 'THERAPIST', 'Nyeri Family Therapy Centre', 'Marriage & Family Therapist',
   'Example application — not yet verified. Premarital and couples counselling.', 'Nyeri')
ON CONFLICT (whatsapp_e164) DO UPDATE SET
  category = EXCLUDED.category,
  affiliation = EXCLUDED.affiliation,
  title = EXCLUDED.title,
  bio = EXCLUDED.bio,
  verification_status = EXCLUDED.verification_status,
  claim_status = EXCLUDED.claim_status,
  location_area = EXCLUDED.location_area;

-- Example applications stay active (visible in the admin roster, like any
-- real application would be) but not available: verification_status alone
-- already keeps them off the public listing and out of the booking flow.
UPDATE professionals SET is_active = true, is_available = false
WHERE whatsapp_e164 LIKE '+2547120002%';
