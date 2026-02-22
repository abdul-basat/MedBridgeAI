import React, { useState, useEffect, useRef } from 'react';
import { Clipboard, ClipboardCheck } from 'lucide-react';

// API config moved to Vercel Serverless Function (/api/generate)

const SOAP_PROMPT = `You are a clinical documentation specialist. Transform raw abbreviated doctor notes into a structured SOAP note.

Use EXACTLY this format:

**SUBJECTIVE**
Chief Complaint: [1 sentence, expand abbreviations]
History of Present Illness: [2-4 sentences, fully expanded]
Reported Symptoms: [bullet list]

**OBJECTIVE**
Vital Signs: [list any — if none: ⚠️ MISSING — Vitals not documented]
Physical Examination: [expand findings — if none: ⚠️ MISSING]
Current Medications: [list all]
Allergies: [list — if none: ⚠️ Not documented]

**ASSESSMENT**
Primary Clinical Impression: [based only on provided data]
Differential Diagnoses: [list 2-3 if inferable]

**PLAN**
Interventions Performed: [what was done]
Follow-up Instructions: [next steps mentioned]
Referrals: [any mentioned]

RULES:
- Expand ALL abbreviations: c/o=complains of, hx=history, HTN=hypertension, DM2=type 2 diabetes, CHF=congestive heart failure, SOB=shortness of breath, SpO2=oxygen saturation, RA=room air, HR=heart rate, RR=respiratory rate, BP=blood pressure, QD=once daily, BID=twice daily, irreg=irregular, JVD=jugular venous distension, BMP=basic metabolic panel, BNP=brain natriuretic peptide, ASA=aspirin, IV=intravenous, wt=weight, PE=physical exam
- Mark missing required fields with ⚠️ MISSING
- NEVER invent clinical data — only restructure what is provided
- Output clean markdown only. No preamble or closing remarks.`;

const FLAG_PROMPT = `You are a clinical safety reviewer. Read this SOAP note and identify documentation problems and clinical red flags.

Return a numbered list. Each item starts with a severity icon:
🔴 CRITICAL — patient safety risk or serious documentation failure
🟡 WARNING — important gap or potential concern
🔵 NOTE — minor improvement or missing optional information

Format each item as: [NUMBER]. [ICON] [CATEGORY]: [Specific explanation referencing actual note data]

Categories to check:
- Missing Vitals (especially critical with cardiac or respiratory symptoms)
- Drug Interactions (check for known conflicts between listed medications)
- Allergy Documentation (flag if allergies not documented before medications given)
- Contradictions (any conflicting information in the note)
- Assessment Gaps (diagnosis without sufficient supporting objective evidence)
- Follow-up Gaps (no follow-up plan when condition warrants one)
- Dosing Concerns (medication doses appearing unusually high or low)

RULES:
- Be specific — reference actual data from the note
- Skip categories with no issues
- If zero flags: respond exactly with: ✅ No critical flags identified. Documentation appears complete.
- Maximum 8 flags, ordered by severity (critical first)
- No preamble or closing remarks`;

const SUMMARY_PROMPT = `You are a patient communication specialist. Rewrite this clinical SOAP note as a warm plain-English patient summary for discharge.

Use EXACTLY this format:

**What Happened Today**
[2-3 sentences explaining the visit in plain language — no jargon]

**What You Should Do Next**
[Bullet list of 3-5 specific follow-up actions]

**Warning Signs — Come Back Immediately If You Notice:**
[Bullet list of 4-6 specific symptoms warranting urgent return or ER visit]

---
⚕️ This summary is for your personal reference only. It does not replace the advice, diagnosis, or treatment plan from your healthcare provider. Please contact your doctor's office if you have any questions.

RULES:
- Grade 8 reading level — no medical jargon
- Replace clinical terms: diaphoresis→heavy sweating, dyspnea→shortness of breath, edema→swelling, bilateral→on both sides, hypertension→high blood pressure, CHF exacerbation→heart failure flare-up, SpO2→blood oxygen level, pitting edema→swelling that leaves a dent when pressed
- Warm reassuring tone
- Only include information from the SOAP note — do not add external advice
- No preamble or closing remarks outside the format`;

function getSpecialtyContext(specialty) {
  const contexts = {
    general: ``,

    cardiology: `
SPECIALTY CONTEXT — CARDIOLOGY:
Pay special attention to: chest pain characteristics (onset, radiation, quality),
cardiac risk factors (HTN, DM, smoking, family history), arrhythmias,
medication interactions involving cardiac drugs (beta-blockers, ACE inhibitors,
statins, anticoagulants, diuretics). In the PLAN section, always check if
cardiology referral is mentioned. Flag any missing echocardiogram or stress test
orders when cardiac diagnosis is suspected.`,

    pediatrics: `
SPECIALTY CONTEXT — PEDIATRICS:
Always note the patient's age and weight prominently in the OBJECTIVE section.
Pay special attention to: immunization status if mentioned, growth and
developmental milestones, weight-based medication dosing, fever management,
parental concerns. Replace adult-centric language with age-appropriate terms.
Flag any medications that require pediatric dose adjustment.`,

    emergency: `
SPECIALTY CONTEXT — EMERGENCY MEDICINE:
Prioritize life-threatening conditions first. Structure the ASSESSMENT section
with a primary emergency diagnosis followed by differentials ranked by acuity.
Always flag: missing triage vitals, missing allergy documentation before
medications, missing IV access documentation, missing disposition plan
(admit / discharge / transfer). Time of presentation and time of interventions
are critical — flag if not documented.`,

    pulmonology: `
SPECIALTY CONTEXT — PULMONOLOGY:
Pay special attention to: SpO2 levels and oxygen delivery method (room air,
nasal cannula, mask), respiratory rate, breath sounds (crackles, wheezing,
diminished), smoking history in pack-years, inhaler medications and compliance,
pulmonary function test results if mentioned. Flag any missing peak flow
measurements or chest X-ray orders when respiratory diagnosis is suspected.`
  };
  return contexts[specialty] || '';
}

function getSpecialtyFlagContext(specialty) {
  const contexts = {
    general: ``,

    cardiology: `
SPECIALTY FLAG FOCUS — CARDIOLOGY:
Prioritize flags for: missing troponin or EKG orders when chest pain present,
missing ejection fraction when CHF mentioned, potential ACE inhibitor +
potassium-sparing diuretic interaction, missing anticoagulation status when
arrhythmia present.`,

    pediatrics: `
SPECIALTY FLAG FOCUS — PEDIATRICS:
Prioritize flags for: weight-based dosing not specified, missing immunization
status, medications contraindicated in children, missing parental consent
notation for procedures.`,

    emergency: `
SPECIALTY FLAG FOCUS — EMERGENCY MEDICINE:
Prioritize flags for: missing disposition plan, missing time stamps on
interventions, missing repeat vital signs after treatment, medications given
without allergy documentation.`,

    pulmonology: `
SPECIALTY FLAG FOCUS — PULMONOLOGY:
Prioritize flags for: missing SpO2 on room air baseline, smoking history
not quantified in pack-years, missing bronchodilator response documentation,
missing chest imaging order when new respiratory symptoms present.`
  };
  return contexts[specialty] || '';
}

const SPECIALTY_OPTIONS = [
  { value: 'general', label: '🏥  General Practice' },
  { value: 'cardiology', label: '❤️  Cardiology' },
  { value: 'pediatrics', label: '👶  Pediatrics' },
  { value: 'emergency', label: '🚨  Emergency Medicine' },
  { value: 'pulmonology', label: '🫁  Pulmonology' }
];

const SPECIALTY_BADGE_STYLE = {
  general: { color: '#8b949e', borderColor: '#30363d', backgroundColor: '#1c2128' },
  cardiology: { color: '#f85149', borderColor: 'rgba(248,81,73,0.3)', backgroundColor: 'rgba(248,81,73,0.07)' },
  pediatrics: { color: '#3fb950', borderColor: 'rgba(63,185,80,0.3)', backgroundColor: 'rgba(63,185,80,0.07)' },
  emergency: { color: '#d29922', borderColor: 'rgba(210,153,34,0.3)', backgroundColor: 'rgba(210,153,34,0.07)' },
  pulmonology: { color: '#79c0ff', borderColor: 'rgba(121,192,255,0.3)', backgroundColor: 'rgba(68,147,248,0.07)' }
};

async function callGemini(systemPrompt, userInput, temperature = 0.2, retries = 3) {
  for (let i = 0; i < retries; i++) {
    let response;

    // In local Vite development, call Gemini directly for convenience.
    // In Vercel production, this code is stripped out, and we use the secure Serverless Function.
    if (import.meta.env.DEV) {
      const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE';
      const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-1.5-pro';
      const ENDPOINT = `https://generativelanguage.googleapis.com/v1alpha/models/${MODEL}:generateContent?key=${API_KEY}`;

      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userInput }] }],
          generationConfig: { temperature, maxOutputTokens: 2000 }
        })
      });
    } else {
      // Secure Vercel Serverless Function endpoint
      response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          userInput,
          temperature
        })
      });
    }

    if (response.ok) {
      const data = await response.json();
      if (!data.candidates || data.candidates.length === 0) {
        console.error("Unexpected Gemini API Response:", data);
        throw new Error("Gemini returned an empty or invalid response format.");
      }
      return data.candidates[0].content.parts[0].text;
    }

    if (response.status === 429) {
      // Free tier rate limit (15 RPM). Apply exponential backoff.
      const delay = Math.pow(2, i) * 3000; // 3s, 6s, 12s...
      console.warn(`Gemini 429 Rate Limit hit. Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    // Other errors (e.g. 400 Bad Request) throw immediately
    const errorData = await response.json().catch(() => ({}));
    console.error(`API error ${response.status}:`, errorData);
    throw new Error(`API error: ${response.status}`);
  }
  throw new Error('Gemini API Rate Limit Exceeded after maximum retries.');
}

export default function App() {
  const [rawNotes, setRawNotes] = useState('');
  const [activeTab, setActiveTab] = useState('soap');
  const [specialty, setSpecialty] = useState('general');

  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [lastGeneratedTime, setLastGeneratedTime] = useState(null);

  const [soapOutput, setSoapOutput] = useState('');
  const [flagsOutput, setFlagsOutput] = useState('');
  const [summaryOutput, setSummaryOutput] = useState('');

  const [hasGenerated, setHasGenerated] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  // Voice input state
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [micError, setMicError] = useState('');
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);

  const outputRef = useRef(null);

  const DEMO_INPUTS = [
    {
      label: "Heart Failure",
      text: "pt 67F c/o SOB × 2wk, progressive. hx CHF, DM2, HTN. meds: lasix 40mg QD, metformin 500mg BID, lisinopril 10mg QD. PE: BP 158/92, HR 94 irreg, RR 22, SpO2 91% RA, wt gain 5lbs past wk. bilateral crackles lower lobes. JVD present. pitting edema bilateral ankles 2+. assessment: acute CHF exacerbation. plan: lasix 80mg IV now, BMP + BNP ordered, cardiology consult, admit for monitoring, hold metformin peri-procedure."
    },
    {
      label: "Pediatrics",
      text: "3yo M brought in by mom for tugging at R ear since yesterday. +fever (Tmax 101.5 at home), fussy, decreased PO intake. No v/d. Sick contacts at daycare. PMHx: healthy. Immunizations UTD. PE: T 38.6C, HR 120, RR 24. Lungs clear. R TM bulging, erythematous, loss of light reflex. L TM normal. Oropharynx clear. Neck supple. A: Acute R otitis media. P: Amoxicillin 90mg/kg/day divided BID x 10 days. Tylenol PRN fever/pain. RTC if no improvement in 48-72h."
    },
    {
      label: "Incomplete Note",
      text: "45yo male complains of severe chest pain that started an hour ago. He says it feels like an elephant is sitting on his chest. It radiates to his left arm. He is sweating a lot. Gave him some aspirin. Needs seeing right away."
    },
    {
      label: "Orthopedics",
      text: "24M presents w/ R ankle pain after twisting it playing basketball 2hrs ago. +swelling, +bruising. Unable to bear wt. PMHx: none. Allergies: PCN. PE: R ankle reveals marked edema lateral aspect, ecchymosis. TTP over anterior talofibular ligament. No proximal fibula tenderness. Neurovascularly intact. X-rays negative for fracture. A: Grade 2 R ankle sprain. P: RICE, NSAIDs, crutches for 2 days, ankle brace. F/up 1 wk if not improving."
    }
  ];

  // Check Web Speech API support on mount
  useEffect(() => {
    const supported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    setSpeechSupported(supported);
  }, []);

  const loadDemo = (text) => {
    setRawNotes(text);
    document.getElementById('generate-btn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Voice input toggle
  const toggleRecording = () => {
    if (isRecording) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsRecording(false);
      setInterimText('');
    } else {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let finalText = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalText += event.results[i][0].transcript + ' ';
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        if (finalText) {
          setRawNotes(prev => prev + finalText);
          // Auto-scroll textarea
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
            }
          }, 50);
        }
        setInterimText(interim);
      };

      recognition.onerror = (event) => {
        let msg = '';
        if (event.error === 'no-speech') msg = 'No speech detected. Try speaking closer to your microphone.';
        else if (event.error === 'audio-capture') msg = 'Microphone not found. Please check your device settings.';
        else if (event.error === 'not-allowed') msg = 'Microphone access denied. Please allow microphone in browser settings.';
        else msg = 'Speech recognition error: ' + event.error;
        setMicError(msg);
        setIsRecording(false);
        setInterimText('');
        setTimeout(() => setMicError(''), 4000);
      };

      recognition.onend = () => {
        setIsRecording(false);
        setInterimText('');
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
    }
  };

  // Clear handler
  const handleClear = () => {
    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }
    setRawNotes('');
    setInterimText('');
  };

  const runDoctorMode = async () => {
    if (!rawNotes.trim()) return;

    // Stop recording if active before generating
    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      setInterimText('');
    }

    setIsLoading(true);
    setErrorMsg('');
    const startTime = performance.now();

    try {
      setStatusText('Running SOAPAgent...');
      const fullSoapPrompt = SOAP_PROMPT + getSpecialtyContext(specialty);
      const soapNote = await callGemini(fullSoapPrompt, rawNotes, 0.2);
      setSoapOutput(soapNote);

      setStatusText('Running FlagAgent + SummaryAgent...');
      setStatusText('Running FlagAgent...');
      const fullFlagPrompt = FLAG_PROMPT + getSpecialtyFlagContext(specialty);
      const flags = await callGemini(fullFlagPrompt, soapNote, 0.1);

      setStatusText('Running SummaryAgent...');
      await new Promise(r => setTimeout(r, 3000)); // 3 second delay to prevent 429 Free Tier rate limit on concurrent calls
      const summary = await callGemini(SUMMARY_PROMPT, soapNote, 0.4, 5);

      setFlagsOutput(flags);
      setSummaryOutput(summary);

      setStatusText('Finalizing output...');
      setHasGenerated(true);
      setActiveTab('soap');

      const endTime = performance.now();
      setLastGeneratedTime(((endTime - startTime) / 1000).toFixed(1));

      if (window.innerWidth < 768 && outputRef.current) {
        setTimeout(() => {
          outputRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('⚠️ Generation failed. Check your API key and try again.');
    } finally {
      setIsLoading(false);
      setStatusText('');
    }
  };

  const handleCopy = () => {
    let copyText = '';
    if (activeTab === 'soap') copyText = soapOutput;
    else if (activeTab === 'flags') copyText = flagsOutput;
    else if (activeTab === 'summary') copyText = summaryOutput;

    if (!copyText) return;

    navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    let fileContent = `==========================================
MEDBRIDGE AI — SOAP NOTE
==========================================
Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
Specialty: ${SPECIALTY_OPTIONS.find(opt => opt.value === specialty)?.label.replace(/[^a-zA-Z\s]/g, '').trim()}
==========================================

${soapOutput.replace(/\*\*/g, '').replace(/#{1,6}\s/g, '')}

==========================================
Generated by MedBridge AI using Gemini 2.0 Flash
Not a substitute for professional medical judgment
==========================================`;

    const date = new Date().toISOString().split('T')[0];
    const filename = `SOAP_Note_${date}.txt`;

    const blob = new Blob([fileContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const formattedSpecialty = SPECIALTY_OPTIONS.find(opt => opt.value === specialty)?.label.replace(/[^a-zA-Z\s]/g, '').trim() || 'General Practice';

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Patient Summary — MedBridge AI</title>
  <style>
    /* Print-optimized styles */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Georgia', serif;
      font-size: 13px;
      line-height: 1.8;
      color: #1a1a1a;
      background: white;
      padding: 40px 48px;
      max-width: 680px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .logo {
      font-family: 'Georgia', serif;
      font-size: 22px;
      font-weight: bold;
      color: #1a1a1a;
    }
    .logo span { color: #2563a8; }
    .meta {
      font-size: 11px;
      color: #666;
      text-align: right;
      line-height: 1.6;
      font-family: 'Courier New', monospace;
    }
    h2 {
      font-size: 13px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #2563a8;
      margin-top: 20px;
      margin-bottom: 6px;
    }
    p { margin-bottom: 8px; color: #1a1a1a; }
    ul { padding-left: 18px; margin-bottom: 8px; }
    li { margin-bottom: 4px; }
    strong { font-weight: bold; }
    .disclaimer {
      margin-top: 32px;
      padding-top: 14px;
      border-top: 1px solid #ccc;
      font-size: 11px;
      color: #888;
      font-style: italic;
      font-family: 'Courier New', monospace;
      line-height: 1.6;
    }
    .footer-bar {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid #e0e0e0;
      font-size: 10px;
      color: #aaa;
      font-family: 'Courier New', monospace;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { padding: 20px 28px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Med<span>Bridge</span> AI</div>
    <div class="meta">
      Patient Summary<br>
      Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}<br>
      Specialty: ${formattedSpecialty}
    </div>
  </div>

  ${window.marked ? window.marked.parse(summaryOutput) : summaryOutput}

  <div class="footer-bar">
    <span>MedBridge AI — LIVE AI Ivy Plus 2026</span>
    <span>Generated with Gemini 2.0 Flash</span>
  </div>
</body>
</html>`;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 500);
  };

  // Flag Counting
  const criticalCount = (flagsOutput.match(/🔴/g) || []).length;
  const warningCount = (flagsOutput.match(/🟡/g) || []).length;
  const totalFlags = criticalCount + warningCount;
  const hasZeroFlags = totalFlags === 0 && flagsOutput.includes('✅');

  // Render Flags parsing
  const renderFlags = () => {
    if (!flagsOutput) return null;

    if (flagsOutput.includes('✅') && !flagsOutput.includes('🔴') && !flagsOutput.includes('🟡')) {
      return (
        <div key="ok" className="flag-item ok">
          {flagsOutput.replace(/\*\*/g, '')}
        </div>
      );
    }

    const items = flagsOutput.split(/(?=\b\d+\.\s*(?:🔴|🟡|🔵))/u).map(s => s.trim()).filter(Boolean);

    return items.map((line, idx) => {
      let flagClass = 'flag-item';
      if (line.includes('🔴')) flagClass += ' critical';
      else if (line.includes('🟡')) flagClass += ' warning';
      else if (line.includes('🔵')) flagClass += ' note';

      // Remove markdown bolding if Gemini added it
      line = line.replace(/\*\*/g, '');

      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const heading = line.substring(0, colonIndex + 1);
        const description = line.substring(colonIndex + 1).trim();
        return (
          <div key={idx} className={flagClass}>
            <div className="flag-heading">{heading}</div>
            <div className="flag-desc">{description}</div>
          </div>
        );
      }

      return (
        <div key={idx} className={flagClass}>
          {line}
        </div>
      );
    });
  };

  // marked.js wrapper
  const getMarkdown = (text) => {
    if (window.marked && text) {
      let html = window.marked.parse(text);
      html = html.replace(/⚠️ MISSING/g, '<span class="missing-text">⚠️ MISSING</span>');
      // custom headers for SOAP notes to style anything between ** ... **
      return { __html: html };
    }
    return { __html: '' };
  };

  return (
    <div className="app-container">
      {import.meta.env.DEV && (!import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') && (
        <div className="api-warning-banner">
          ⚠️ Local Dev: Add VITE_GEMINI_API_KEY to your .env file to enable generation.
        </div>
      )}

      {/* NAVBAR */}
      <nav className="navbar">
        <div className="nav-logo">
          <div className="nav-dot"></div> MedBridge AI
        </div>
        <div className="nav-toggle">
          <button className="toggle-btn active-toggle">🩺 Doctor</button>
          <button className="toggle-btn disabled-toggle" disabled>
            🤒 Patient <span className="soon-badge">soon</span>
          </button>
        </div>
      </nav>

      {/* HERO STRIP */}
      <div className="hero-strip">
        <div className="hero-text">Transform raw clinical notes into structured documentation — powered by Gemini AI</div>
        <div className="hero-badges">
          <span className="badge badge-blue">🤖 3 AI Agents</span>
          <span className="badge badge-green">⚡ ~4 sec</span>
          <span className="badge badge-amber">🏥 SOAP · Flags · Summary</span>
        </div>
      </div>

      {/* MAIN BODY */}
      <main className="main-content">

        {/* LEFT COLUMN */}
        <div className="panel input-panel">
          <div className="panel-header" style={{ position: 'relative' }}>
            <span className="panel-label">RAW CLINICAL NOTES</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isRecording && (
                <span className="live-badge">
                  <span className="live-dot"></span> LIVE
                </span>
              )}
              <span className="panel-sub">paste or type below</span>
            </div>
          </div>

          <div className="specialty-selector-row">
            <span className="specialty-label">Specialty</span>
            <select
              className="specialty-dropdown"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              disabled={isLoading}
            >
              {SPECIALTY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Mic Button / Browser Compatibility */}
          {speechSupported ? (
            <button
              className={`mic-btn ${isRecording ? 'mic-recording' : ''}`}
              onClick={toggleRecording}
              title={isRecording ? 'Click to stop recording' : 'Click to dictate your clinical notes'}
            >
              {isRecording ? (
                <><span className="pulse-dot"></span> Recording... Click to Stop</>
              ) : (
                <>🎙️  Click to Dictate Notes</>
              )}
            </button>
          ) : (
            <div className="speech-unsupported">🎙️ Voice input works in Chrome &amp; Edge</div>
          )}

          {micError && <div className="mic-error">{micError}</div>}

          <div className="clinical-console">
            <div className="console-header">
              <div className="console-dots">
                <span></span><span></span><span></span>
              </div>
              <span className="console-title">INPUT_STREAM v2.0</span>
            </div>
            <textarea
              ref={textareaRef}
              className={`styled-textarea ${isRecording ? 'textarea-recording' : ''}`}
              placeholder={"Paste or type clinical notes here...\n\nExample:\npt 45M c/o chest pain 3d, hx HTN,\nsmoker 20yr, diaphoresis +,\ngave ASA 325mg, refer cardio"}
              value={rawNotes}
              onChange={(e) => setRawNotes(e.target.value)}
            />
            <div className="console-footer">
              <span className="char-count">{rawNotes.length} characters</span>
              {rawNotes && !isRecording && (
                <button className="console-clear" onClick={handleClear}>✕ RESET CONSOLE</button>
              )}
            </div>
          </div>

          {/* Interim preview */}
          {isRecording && interimText && (
            <div className="interim-preview">...{interimText}</div>
          )}

          <div className="demo-cards-container">
            <div className="demo-label">TRY A DEMO</div>
            <div className="demo-buttons">
              {DEMO_INPUTS.map((demo, idx) => (
                <button
                  key={idx}
                  className="demo-card-btn"
                  onClick={() => loadDemo(demo.text)}
                  title={demo.text}
                >
                  {demo.label}
                </button>
              ))}
            </div>
          </div>

          <button
            id="generate-btn"
            className={`generate-btn ${isLoading ? 'loading' : ''}`}
            onClick={runDoctorMode}
            disabled={!rawNotes.trim() || isLoading}
          >
            {isLoading ? (
              <div className="loading-content">
                <div className="dots-container">
                  <div className="dot d1"></div>
                  <div className="dot d2"></div>
                  <div className="dot d3"></div>
                </div>
              </div>
            ) : (
              '✦  Generate SOAP Note'
            )}
          </button>

          {isLoading && <div className="status-text">{statusText}</div>}

          {!isLoading && lastGeneratedTime && (
            <div className="status-text">Last generated: {lastGeneratedTime} seconds</div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="panel output-panel" ref={outputRef}>
          <div className="panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="panel-label">OUTPUT</span>
              {hasGenerated && (
                <span className="specialty-badge" style={SPECIALTY_BADGE_STYLE[specialty]}>
                  {SPECIALTY_OPTIONS.find(opt => opt.value === specialty)?.label.replace(/[^a-zA-Z\s]/g, '').trim().toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {hasGenerated && activeTab === 'summary' && (
                <button className="action-btn" onClick={handlePrint} title="Print Summary">
                  🖨️  Print
                </button>
              )}
              {hasGenerated && activeTab === 'soap' && (
                <button className="action-btn" onClick={handleDownload} title="Download SOAP Note" style={downloaded ? { color: '#3fb950', borderColor: '#3fb950' } : {}}>
                  {downloaded ? '✓ Downloaded!' : '⬇️  Download .txt'}
                </button>
              )}
              {hasGenerated && (
                <button className="copy-btn" onClick={handleCopy} title="Copy all output">
                  {copied ? <ClipboardCheck size={14} color="#3fb950" /> : <Clipboard size={14} />}
                  <span style={{ marginLeft: '4px', color: copied ? '#3fb950' : '#8b949e' }}>
                    {copied ? 'Copied!' : 'Copy All'}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="tabs">
            <button
              className={`tab ${activeTab === 'soap' ? 'active-tab' : ''}`}
              onClick={() => setActiveTab('soap')}
            >
              SOAP Note
            </button>
            <button
              className={`tab ${activeTab === 'flags' ? 'active-tab' : ''}`}
              onClick={() => setActiveTab('flags')}
            >
              ⚠️ Flags
              {totalFlags > 0 && <span className="flags-badge">{totalFlags}</span>}
              {hasZeroFlags && <span className="flags-ok">✓</span>}
            </button>
            <button
              className={`tab ${activeTab === 'summary' ? 'active-tab' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              Patient Summary
            </button>
          </div>

          <div className="output-content">
            {errorMsg && <div className="error-banner">{errorMsg}</div>}

            {!hasGenerated && !errorMsg && (
              <div className="empty-state">
                <div className="medical-cross">✚</div>
                <div>Output will appear here after generation</div>
              </div>
            )}

            {hasGenerated && activeTab === 'soap' && (
              <div
                className="markdown-body soap-content fade-in"
                dangerouslySetInnerHTML={getMarkdown(soapOutput)}
              />
            )}

            {hasGenerated && activeTab === 'flags' && (
              <div className="flags-content fade-in">
                {renderFlags()}
              </div>
            )}

            {hasGenerated && activeTab === 'summary' && (
              <div
                className="markdown-body summary-content fade-in"
                dangerouslySetInnerHTML={getMarkdown(summaryOutput)}
              />
            )}
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="footer">
        <div className="footer-left">⚕️ MedBridge AI is not a substitute for professional medical advice, diagnosis, or treatment.</div>
        <div className="footer-right">LIVE AI Ivy Plus 2026 · Hackathon Project</div>
      </footer>

      <style>{`
    html, body {
      height: 100%;
    }
        .app-container {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
        
        .api-warning-banner {
    background-color: #d29922;
    color: #161b22;
    text-align: center;
    padding: 8px;
    font-size: 13px;
    font-weight: 600;
  }

        /* NAVBAR */
        .navbar {
    position: sticky;
    top: 0;
    z-index: 100;
    height: 52px;
    background-color: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
  }
        .nav-logo {
    font-family: 'Fraunces', serif;
    font-size: 18px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }
        .nav-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--blue-accent);
  }
        .nav-toggle {
    background-color: #21262d;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
    display: flex;
    gap: 2px;
  }
        .toggle-btn {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 12px;
    padding: 4px 12px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
        .active-toggle {
    background-color: var(--blue-accent);
    color: white;
    font-weight: 500;
  }
        .disabled-toggle {
    background-color: transparent;
    color: #656d76;
    cursor: not-allowed;
  }
        .soon-badge {
    background-color: #2a1f0a;
    color: var(--amber);
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    font-family: 'IBM Plex Mono', monospace;
    letter-spacing: 0;
    text-transform: lowercase;
  }

        /* HERO STRIP */
        .hero-strip {
    height: 52px;
    background-color: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
  }
        .hero-text {
    font-size: 12px;
    color: var(--muted-text);
  }
        .hero-badges {
    display: flex;
    gap: 8px;
  }
        .badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid;
    white-space: nowrap;
  }
        .badge-blue {
    color: #79c0ff;
    background-color: rgba(68, 147, 248, 0.08);
    border-color: rgba(121, 192, 255, 0.2);
  }
        .badge-green {
    color: var(--green);
    background-color: rgba(63, 185, 80, 0.08);
    border-color: rgba(63, 185, 80, 0.2);
  }
        .badge-amber {
    color: var(--amber);
    background-color: rgba(210, 153, 34, 0.08);
    border-color: rgba(210, 153, 34, 0.2);
  }

        /* MAIN BODY */
        .main-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    flex: 1;
  }
        .panel {
    padding: 24px;
  }
        .input-panel {
    border-right: 1px solid var(--border);
  }
        .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
        .panel-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #656d76;
  }
        .panel-sub {
    font-size: 11px;
    color: var(--muted-text);
  }

        /* TEXTAREA */
        .styled-textarea {
    width: 100%;
    height: 220px;
    background-color: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: #ffa657;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12.5px;
    line-height: 1.6;
    padding: 14px;
    resize: vertical;
    margin-bottom: 16px;
    outline: none;
  }
        .styled-textarea:focus {
    border-color: var(--blue-accent);
  }
         .styled-textarea::placeholder {
    color: #3d444d;
  }
         .styled-textarea.textarea-recording {
    border-left: 2px solid rgba(248, 81, 73, 0.5);
  }

         /* CLINICAL CONSOLE REDESIGN */
         .clinical-console {
    background-color: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 16px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
  }
         .console-header {
    background-color: #21262d;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #30363d;
  }
         .console-dots {
    display: flex;
    gap: 4px;
  }
         .console-dots span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #30363d;
  }
         .console-dots span:nth-child(1) { background-color: #f85149; opacity: 0.6; }
         .console-dots span:nth-child(2) { background-color: #d29922; opacity: 0.6; }
         .console-dots span:nth-child(3) { background-color: #3fb950; opacity: 0.6; }
         .console-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    color: #8b949e;
    letter-spacing: 1px;
  }
         .clinical-console .styled-textarea {
    border: none;
    margin-bottom: 0;
    border-radius: 0;
    background-color: transparent;
    min-height: 240px;
  }
         .console-footer {
    background-color: #0d1117;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid #21262d;
  }
         .char-count {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: #3d444d;
  }
         .console-clear {
    background: transparent;
    border: 1px solid #30363d;
    color: #656d76;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }
         .console-clear:hover {
    color: #f85149;
    border-color: #f85149;
    background-color: rgba(248, 81, 73, 0.05);
  }
         .clinical-console:focus-within {
    border-color: #4493f8;
    box-shadow: 0 0 0 1px #4493f8, 0 8px 24px rgba(68, 147, 248, 0.15);
  }

         /* MIC BUTTON */
         .mic-btn {
    width: 100%;
    height: 40px;
    background-color: #1c2128;
    border: 1px solid #30363d;
    border-radius: 8px;
    color: #8b949e;
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 12px;
    transition: all 0.2s ease;
  }
         .mic-btn:hover {
    border-color: #4493f8;
    color: #4493f8;
    background-color: rgba(68, 147, 248, 0.06);
  }
         .mic-btn.mic-recording {
    background-color: rgba(248, 81, 73, 0.1);
    border-color: #f85149;
    color: #f85149;
  }
         .mic-btn.mic-recording:hover {
    background-color: rgba(248, 81, 73, 0.15);
  }

         /* PULSE DOT */
         .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #f85149;
    display: inline-block;
    animation: pulse-record 1s ease-in-out infinite;
  }
  @keyframes pulse-record {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.75); }
  }

         /* LIVE BADGE */
         .live-badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #f85149;
    background-color: rgba(248, 81, 73, 0.1);
    border: 1px solid rgba(248, 81, 73, 0.3);
    border-radius: 100px;
    padding: 3px 8px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    animation: fadeIn 0.3s ease forwards;
  }
         .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #f85149;
    display: inline-block;
    animation: pulse-record 1s ease-in-out infinite;
  }

         /* INTERIM PREVIEW */
         .interim-preview {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #3d444d;
    font-style: italic;
    padding: 4px 2px;
    margin-bottom: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

         /* SPEECH UNSUPPORTED */
         .speech-unsupported {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #656d76;
    text-align: center;
    margin-bottom: 12px;
  }

         /* MIC ERROR */
         .mic-error {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #f85149;
    margin-bottom: 8px;
    animation: fadeIn 0.3s ease forwards;
  }

         /* DEMO CARDS */
        .demo-cards-container {
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 16px;
  }
        .demo-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: var(--amber);
    text-transform: uppercase;
    margin-bottom: 10px;
    letter-spacing: 0.08em;
  }
        .demo-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
        .demo-card-btn {
    background-color: var(--bg);
    border: 1px solid var(--border);
    color: var(--muted-text);
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 11.5px;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }
        .demo-card-btn:hover {
    border-color: var(--blue-accent);
    color: var(--blue-accent);
    background-color: rgba(68, 147, 248, 0.05);
  }

        /* BUTTONS & STATUS */
        .generate-btn {
    width: 100%;
    height: 44px;
    background-color: var(--blue-accent);
    color: white;
    font-size: 14px;
    font-weight: 600;
    font-family: 'IBM Plex Sans', sans-serif;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 6px;
    transition: background-color 0.2s;
  }
        .generate-btn:disabled {
    background-color: #1a2a4a;
    color: #656d76;
    cursor: not-allowed;
  }
        .generate-btn:hover:not(:disabled) {
    background-color: #3182ce;
  }
        .status-text {
    text-align: center;
    font-size: 11px;
    color: var(--muted-text);
    font-family: 'IBM Plex Mono', monospace;
    margin-top: 6px;
  }

        .loading-content {
    display: flex;
    justify-content: center;
    align-items: center;
  }
        .dots-container {
    display: flex;
    gap: 6px;
  }
        .dot {
    width: 8px;
    height: 8px;
    background-color: var(--blue-accent);
    border-radius: 50%;
    animation: pulse 1s infinite;
  }
        .d1 { animation-delay: 0s; }
        .d2 { animation-delay: 0.15s; }
        .d3 { animation-delay: 0.3s; }

  @keyframes pulse {
    0%, 100% { opacity: 0.2; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }

        /* RIGHT PANEL */
        .tabs {
    background-color: #21262d;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
    margin-bottom: 12px;
    display: flex;
    gap: 2px;
  }
        .tab {
    flex: 1;
    background: transparent;
    border: none;
    color: #656d76;
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    position: relative;
  }
        .active-tab {
    background-color: #2d333b;
    color: var(--primary-text);
    font-weight: 500;
  }
        .flags-badge {
    position: absolute;
    top: -4px;
    right: 15%;
    background-color: var(--red);
    color: white;
    border-radius: 50%;
    height: 18px;
    width: 18px;
    font-size: 10px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }
        .flags-ok {
    color: var(--green);
    font-size: 12px;
    margin-left: 6px;
  }
        
        .copy-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted-text);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
  }
        .copy-btn:hover {
    background-color: var(--surface);
    color: var(--primary-text);
  }

        .output-content {
    background-color: var(--output-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 18px;
    min-height: 320px;
  }
        
        .fade -in {
    animation: fadeIn 0.3s ease forwards;
  }
  @keyframes fadeIn {
           from { opacity: 0; transform: translateY(4px); }
           to { opacity: 1; transform: translateY(0); }
  }
        
        .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 280px;
    color: #3d444d;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    gap: 12px;
  }
        .medical-cross {
    font-size: 28px;
    color: #30363d;
  }
        .error-banner {
    background-color: rgba(248, 81, 73, 0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 12px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 16px;
  }

        /* SOAP Markdown Styling */
        .soap-content {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12.5px;
    line-height: 1.8;
    color: #c9d1d9;
  }
        .soap-content p {
    margin-bottom: 12px;
  }
        .soap-content ul {
    padding-left: 20px;
    margin-bottom: 12px;
  }
        .soap-content strong {
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--blue-accent);
    font-size: 10px;
    font-weight: 600;
    margin-top: 16px;
    margin-bottom: 4px;
    display: block;
  }
        .missing-text {
    color: var(--red);
    font-weight: bold;
  }

        /* Flags Block Styling */
        .flags-content {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 13px;
    color: #c9d1d9;
  }
        .flag-item {
    padding: 10px 14px;
    margin-bottom: 8px;
    border-radius: 0 6px 6px 0;
    font-weight: 400;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
        .flag-heading {
    font-weight: 600;
    font-size: 13.5px;
  }
        .flag-desc {
    font-size: 13px;
    line-height: 1.5;
    opacity: 0.9;
  }
        .flag-item.critical {
    border-left: 3px solid var(--red);
    color: var(--red);
    background-color: rgba(248, 81, 73, 0.06);
  }
        .flag-item.warning {
    border-left: 3px solid var(--amber);
    color: var(--amber);
    background-color: rgba(210, 153, 34, 0.06);
  }
        .flag-item.note {
    border-left: 3px solid var(--blue-accent);
    color: var(--blue-accent);
    background-color: rgba(68, 147, 248, 0.06);
  }
        .flag-item.ok {
    color: var(--green);
    text-align: center;
    padding: 16px;
    display: block;
  }

        /* Summary Content Typography */
        .summary-content {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 14px;
    line-height: 1.8;
    color: #c9d1d9;
  }
        .summary-content strong {
    color: var(--blue-accent);
    font-weight: 600;
    display: block;
    margin-top: 18px;
    margin-bottom: 6px;
  }
        .summary-content p {
    margin-bottom: 14px;
  }
        .summary-content ul {
    padding-left: 20px;
    margin-bottom: 16px;
  }
        .summary-content hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin-top: 24px;
    margin-bottom: 14px;
  }
        .summary-content p:last-child {
    color: #656d76;
    font-size: 12px;
    font-style: italic;
    margin-bottom: 0;
  }

        /* FOOTER */
        .footer {
    background-color: var(--surface);
    border-top: 1px solid var(--border);
    padding: 14px 24px;
    display: flex;
    color: #656d76;
    font-size: 12px;
  }

         /* SPECIALTY SELECTOR */
         .specialty-selector-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 10px 0;
    gap: 12px;
  }
         .specialty-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #656d76;
  }
         .specialty-dropdown {
    background-color: #1c2128;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 6px 10px;
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #e6edf3;
    cursor: pointer;
    min-width: 200px;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238b949e' viewBox='0 0 16 16'%3E%3Cpath d='M8 11.5l-5-5 1.5-1.5L8 8.5l3.5-3.5L13 6.5z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
  }
         .specialty-dropdown:hover {
    border-color: #4493f8;
  }
         .specialty-dropdown:focus {
    outline: none;
    border-color: #4493f8;
    box-shadow: 0 0 0 3px rgba(68, 147, 248, 0.15);
  }

         /* SPECIALTY BADGE */
         .specialty-badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid;
  }

         /* ACTION BUTTONS (Print/Download) */
         .action-btn {
    background: transparent;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 4px 10px;
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 11px;
    font-weight: 500;
    color: #8b949e;
    cursor: pointer;
    transition: all 0.15s ease;
  }
         .action-btn:hover {
    border-color: #4493f8;
    color: #4493f8;
    background-color: rgba(68, 147, 248, 0.06);
  }

  @media screen and (max-width: 768px) {
           .hero-strip {
      flex-direction: column;
      height: auto;
      padding: 12px 24px;
      align-items: flex-start;
      gap: 8px;
    }
           .hero-text {
      line-height: 1.4;
    }
           .main-content {
      grid-template-columns: 1fr;
    }
           .input-panel {
      border-right: none;
      border-bottom: 1px solid var(--border);
      padding: 18px 20px;
    }
           .output-panel {
      padding: 18px 20px;
    }
           .styled-textarea {
      height: 160px;
    }
            .generate-btn {
      height: 48px;
    }
            .mic-btn {
      height: 48px;
    }
           .footer {
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      gap: 8px;
      padding: 16px 20px;
    }
           .nav-toggle span {
      display: none;
    }
  }
  `}</style>
    </div>
  );
}
