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
