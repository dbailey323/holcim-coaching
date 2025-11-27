import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileAudio, CheckCircle, AlertCircle, Save, Download, RefreshCw, 
  Settings, Printer, Lock, Key, BarChart3, User, Play, Pause, Volume2, 
  FileSpreadsheet, PenTool, ShieldCheck, LogOut, ChevronRight, Users, UserPlus, X, Network, Zap 
} from 'lucide-react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from 'firebase/auth';

// --- ENVIRONMENT VARIABLE HELPER ---
const getEnvVar = (key) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      return import.meta.env[key];
    }
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
  } catch (e) { }
  return undefined;
};

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: getEnvVar('VITE_FIREBASE_API_KEY') || "AIzaSyBKaWwLtoLvKpDjl1ZNuehVpw4KXtfFQHs",
  authDomain: "holcim-coaching.firebaseapp.com",
  projectId: "holcim-coaching",
  storageBucket: "holcim-coaching.firebasestorage.app",
  messagingSenderId: "478954682",
  appId: "1:478954682:web:c391799e578c5a129bee83"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// --- STRICT Rubric & System Prompt ---
const SYSTEM_PROMPT = `
You are a strict and critical Quality Assurance Manager for Holcim UK Service Desk. Your task is to audit a call recording against the specific "Call Quality Monitoring Best Practices Policy".

### CRITICAL INSTRUCTIONS:
1. **BE STRICT**: Do not be lenient. A score of 5 is rare.
2. **NEGATIVE MARKING**: If a step is missed, penalize exactly as defined.
3. **TIMESTAMPS**: You MUST cite specific timestamps for evidence in your comments (e.g., "[01:15] Agent interrupted", "[00:30] Good use of name").
4. **DETAILED FEEDBACK**: Write a professional narrative explaining exactly *why* points were deducted, referencing the audio time.
5. **OUTPUT JSON**: You must output ONLY valid JSON.

### HOLD PROCEDURE SPECIFICS:
- **Hold Music Detected**: ONLY score this section if actual hold music is heard. Evaluate: Did they ask permission? Did they wait for an answer? Did they thank the user upon return?
- **Dead Air/Silence**: If the agent is silent while checking information (no music), you may mention this in the comments (e.g., "Long silence noted at [02:30]"), but you MUST set "hold_na": true. Do NOT score this as a failure.
- **No Hold Used**: If no hold music is used at all, set "hold_na": true. This removes the section from scoring.

### STRICT SCORING MATRIX (0-5):
1. **Greeting & Introduction (5%)**
2. **Communication Style (10%)**
3. **Issue Handling & Clarity (20%)**
4. **Hold Procedure (10%)** - See specific logic above.
5. **Professionalism & Empathy (15%)**
6. **Resolution & Next Steps (15%)**
7. **Call Closure (5%)**
8. **Compliance & System Use (20%)**

### OUTPUT FORMAT (JSON ONLY):
{
  "scores": { "greeting": 0-5, "comm_style": 0-5, "issue_handling": 0-5, "hold_proc": 0-5, "prof_empathy": 0-5, "resolution": 0-5, "closure": 0-5, "compliance": 0-5 },
  "comments": { "greeting": "string", "comm_style": "string", ... },
  "hold_na": boolean,
  "executive_summary": "string",
  "detailed_strengths": ["string"],
  "detailed_improvements": ["string"]
}
`;

const CRITERIA = [
  { id: 'greeting', title: 'Greeting & Introduction', weight: 5, short: 'Greeting' },
  { id: 'comm_style', title: 'Communication Style', weight: 10, short: 'Comm Style' },
  { id: 'issue_handling', title: 'Issue Handling & Clarity', weight: 20, short: 'Issue Handling' },
  { id: 'hold_proc', title: 'Hold Procedure', weight: 10, allowNA: true, short: 'Hold Proc' },
  { id: 'prof_empathy', title: 'Professionalism & Empathy', weight: 15, short: 'Empathy' },
  { id: 'resolution', title: 'Resolution & Next Steps', weight: 15, short: 'Resolution' },
  { id: 'closure', title: 'Call Closure', weight: 5, short: 'Closure' },
  { id: 'compliance', title: 'Compliance & System Use', weight: 20, short: 'Compliance' }
];

const BRAND = {
  navy: '#001A41',
  green: '#76BC21',
  cyan: '#009FE3',
  grey: '#F3F4F6'
};

// --- IMAGE LOGO COMPONENT ---
const HolcimLogo = ({ className = "h-12" }) => (
  <img 
    src="/logo.png" 
    alt="Holcim Logo" 
    className={`${className} w-auto object-contain`}
    onError={(e) => {
      e.target.style.display = 'none';
      const span = document.createElement('span');
      span.innerText = "HOLCIM";
      span.style.fontWeight = "900";
      span.style.fontSize = "24px";
      span.style.color = BRAND.navy;
      span.style.fontFamily = "sans-serif";
      e.target.parentNode.appendChild(span);
    }}
  />
);

// --- Custom Radar Chart Component ---
const RadarChart = ({ scores, naFlags }) => {
  const size = 300;
  const center = size / 2;
  const radius = (size / 2) - 40; 
  const angleSlice = (Math.PI * 2) / CRITERIA.length;

  const getCoords = (value, index) => {
    const r = (value / 5) * radius;
    const angle = index * angleSlice - Math.PI / 2;
    return { x: center + r * Math.cos(angle), y: center + r * Math.sin(angle) };
  };

  const points = CRITERIA.map((c, i) => {
    const val = naFlags[c.id] ? 0 : (scores[c.id] || 0);
    const { x, y } = getCoords(val, i);
    return `${x},${y}`;
  }).join(' ');

  const levels = [1, 2, 3, 4, 5];

  return (
    <div className="flex justify-center items-center py-4">
      <svg width={size} height={size} className="overflow-visible">
        {levels.map((level) => (
          <polygon key={level} points={CRITERIA.map((_, i) => { const r = (level / 5) * radius; const angle = i * angleSlice - Math.PI / 2; return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`; }).join(' ')} fill={level === 5 ? '#f0fdf4' : 'none'} stroke="#e2e8f0" strokeWidth="1" />
        ))}
        {CRITERIA.map((c, i) => { const { x, y } = getCoords(5, i); return ( <g key={i}> <line x1={center} y1={center} x2={x} y2={y} stroke="#cbd5e1" strokeWidth="1" /> <text x={x + (x > center ? 10 : -10)} y={y + (y > center ? 10 : -10)} textAnchor={x > center ? 'start' : 'end'} dominantBaseline="middle" className="text-[10px] fill-slate-500 font-medium uppercase">{c.short}</text> </g> ); })}
        <polygon points={points} fill={`${BRAND.green}33`} stroke={BRAND.green} strokeWidth="2" />
        {CRITERIA.map((c, i) => { const val = naFlags[c.id] ? 0 : (scores[c.id] || 0); const { x, y } = getCoords(val, i); return <circle key={i} cx={x} cy={y} r="4" fill={BRAND.green} />; })}
      </svg>
    </div>
  );
};

const TimestampedText = ({ text, onSeek }) => {
  if (!text) return null;
  const regex = /(\[\d{1,2}:\d{2}\])/g;
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) => {
        if (regex.test(part)) {
          const timeStr = part.replace('[', '').replace(']', '');
          const [mins, secs] = timeStr.split(':').map(Number);
          const totalSeconds = (mins * 60) + secs;
          return (
            <button key={i} onClick={() => onSeek(totalSeconds)} style={{ color: BRAND.navy, backgroundColor: '#E0F2FE' }} className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded text-xs font-bold hover:opacity-80 transition-opacity cursor-pointer align-baseline no-print"> <Play size={8} fill="currentColor" /> {timeStr} </button>
          );
        }
        if (regex.test(part)) return <span key={i} className="hidden print:inline font-mono text-xs text-slate-500"> {part} </span>;
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

// --- Login Component ---
const LoginScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError("Invalid credentials. Please check your email and password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4 font-sans">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        <div className="p-8 pb-6 text-center border-b border-slate-100">
           <div className="flex justify-center items-center gap-3 mb-4">
              <HolcimLogo className="h-16" />
           </div>
           <p className="text-slate-500 font-medium">Service Desk Coaching Portal</p>
        </div>
        <form onSubmit={handleLogin} className="p-8 pt-6 space-y-6">
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
          <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-slate-500">Email Address</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 transition-all" style={{ '--tw-ring-color': BRAND.green }} placeholder="name@holcim.com" /></div>
          <div className="space-y-2"><label className="text-xs font-bold uppercase tracking-wider text-slate-500">Password</label><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 transition-all" style={{ '--tw-ring-color': BRAND.green }} placeholder="••••••••" /></div>
          <button type="submit" disabled={loading} className="w-full py-3 rounded-lg font-bold text-white shadow-lg hover:opacity-90 transition-all flex justify-center items-center gap-2" style={{ backgroundColor: BRAND.green }}>{loading ? 'Authenticating...' : 'Sign In securely'} {!loading && <ChevronRight size={18} />}</button>
        </form>
        <div className="bg-slate-50 p-4 text-center text-xs text-slate-400 border-t border-slate-100"><ShieldCheck size={12} className="inline mr-1" /> Restricted Access - Authorized Personnel Only</div>
      </div>
    </div>
  );
};

// --- Admin User Creator ---
const AdminUserCreator = ({ onClose }) => {
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [loading, setLoading] = useState(false);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg({ text: '', type: '' });
    const secondaryApp = initializeApp(firebaseConfig, "Secondary");
    const secondaryAuth = getAuth(secondaryApp);
    try {
      await createUserWithEmailAndPassword(secondaryAuth, newEmail, newPassword);
      await signOut(secondaryAuth);
      setMsg({ text: `Successfully created user: ${newEmail}`, type: 'success' });
      setNewEmail(''); setNewPassword('');
    } catch (error) {
      setMsg({ text: error.message, type: 'error' });
    } finally {
      deleteApp(secondaryApp);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><UserPlus size={24} /></div>
            <div><h3 className="font-bold text-xl text-slate-800">Create New User</h3><p className="text-xs text-slate-500">Add access for a new analyst or manager</p></div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
        </div>
        <div className="p-8 bg-slate-50">
          {msg.text && <div className={`mb-6 p-4 rounded-lg text-sm flex items-center gap-2 ${msg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}{msg.text}</div>}
          <form onSubmit={handleCreateUser} className="space-y-5">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-2">New User Email</label><input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="analyst@holcim.com" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-2">Temporary Password</label><input type="text" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Min 6 chars" /></div>
            <div className="pt-2"><button type="submit" disabled={loading} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow transition-all flex justify-center items-center gap-2">{loading ? 'Creating Account...' : 'Create Account'}</button></div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default function CallCoachingApp() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  // Main State
  const [view, setView] = useState('upload'); 
  const [file, setFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const audioRef = useRef(null);
   
  // --- GOOGLE GEMINI API KEYS ---
  // Using direct REST API, so no SDK import is needed.
  const [apiKey, setApiKey] = useState(getEnvVar('VITE_GEMINI_API_KEY') || '');
   
  const [showSettings, setShowSettings] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [agentName, setAgentName] = useState('');
  const [scores, setScores] = useState({});
  const [comments, setComments] = useState({});
  const [naFlags, setNaFlags] = useState({});
  const [executiveSummary, setExecutiveSummary] = useState("");
  const [detailedStrengths, setDetailedStrengths] = useState([]);
  const [detailedImprovements, setDetailedImprovements] = useState([]);
  const [agreedAction, setAgreedAction] = useState('');
  const [reviewDate, setReviewDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const initialScores = {}; const initialComments = {}; const initialNa = {};
    CRITERIA.forEach(c => { initialScores[c.id] = 0; initialComments[c.id] = "Pending analysis..."; initialNa[c.id] = false; });
    setScores(initialScores); setComments(initialComments); setNaFlags(initialNa);
  }, []);

  useEffect(() => { return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }; }, [audioUrl]);

  const handleLogout = async () => await signOut(auth);
  const seekTo = (seconds) => { if (audioRef.current) { audioRef.current.currentTime = seconds; audioRef.current.play(); } };

  const calculateTotals = () => {
    let totalWeight = 0; let weightedScoreSum = 0;
    CRITERIA.forEach(c => { if (naFlags[c.id] && c.allowNA) return; totalWeight += c.weight; weightedScoreSum += (scores[c.id] * c.weight); });
    const maxPossibleWeightedScore = totalWeight * 5;
    const percentage = maxPossibleWeightedScore > 0 ? (weightedScoreSum / maxPossibleWeightedScore) * 100 : 0;
    return { percentage: percentage.toFixed(1) };
  };

  // --- GOOGLE GEMINI DIRECT API ANALYSIS (NO SDK) ---
  const analyzeWithGeminiAPI = async (audioFile) => {
    if (!apiKey) { 
      setError("Gemini API Key missing. Check Vercel Environment Variables (VITE_GEMINI_API_KEY) or enter in settings."); 
      setView('upload'); 
      return; 
    }
    
    setIsProcessing(true); 
    setError('');
    
    try {
      // 1. Convert Audio to Base64 (stripping the data URL prefix)
      const base64AudioData = await new Promise((resolve, reject) => { 
        const reader = new FileReader(); 
        reader.readAsDataURL(audioFile); 
        reader.onload = () => {
            const result = reader.result;
            // Remove "data:audio/wav;base64," prefix for API usage
            const base64Data = result.split(',')[1];
            resolve(base64Data);
        }; 
        reader.onerror = error => reject(error); 
      });

      // 2. Construct Payload for REST API
      const payload = {
        contents: [{
          parts: [
            { text: `${SYSTEM_PROMPT}\n\nPlease audit this call recording provided in the audio attachment based on the strict policy above.` },
            {
              inline_data: {
                mime_type: audioFile.type || "audio/mp3",
                data: base64AudioData
              }
            }
          ]
        }],
        generationConfig: {
          response_mime_type: "application/json"
        }
      };

      // 3. Send Request to Google REST Endpoint
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || `API Error: ${response.status}`);
      }

      const data = await response.json();
      
      // 4. Parse Response
      // Gemini's structure: candidates[0].content.parts[0].text
      if (!data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
        throw new Error("Invalid response format from Gemini API");
      }

      const jsonResult = JSON.parse(data.candidates[0].content.parts[0].text);

      // 5. Map Data to State
      setScores(jsonResult.scores); 
      setComments(jsonResult.comments); 
      setNaFlags(prev => ({ ...prev, hold_proc: jsonResult.hold_na || false }));
      setExecutiveSummary(jsonResult.executive_summary || "No summary generated."); 
      setDetailedStrengths(jsonResult.detailed_strengths || []); 
      setDetailedImprovements(jsonResult.detailed_improvements || []);
      
      setView('report');
    } catch (err) { 
      console.error(err);
      setError("Gemini API Analysis Failed: " + (err.message || err.toString())); 
      setView('upload'); 
    } finally { 
      setIsProcessing(false); 
    }
  };

  const handleMockAnalysis = () => {
    setIsProcessing(true);
    setTimeout(() => {
      const newScores = {}; const newComments = {};
      CRITERIA.forEach(c => { newScores[c.id] = Math.floor(Math.random() * 3) + 2; newComments[c.id] = `Mock analysis. [00:30] Good behavior noted. [01:15] Slight error detected.`; });
      setScores(newScores); setComments(newComments);
      setExecutiveSummary("Mock summary: Call started well at [00:05]. Issues at [01:20]. Closed well at [02:30].");
      setDetailedStrengths(["Polite greeting [00:05]."]); setDetailedImprovements(["Missed security [00:40]."]);
      setIsProcessing(false); setView('report');
    }, 2000);
  };

  const handleUpload = (e) => {
    const uploadedFile = e.target.files ? e.target.files[0] : null;
    if (uploadedFile) { 
      if(!agentName.trim()) { setError("Please enter the Analyst's Name."); return; } 
      setFile(uploadedFile); 
      setAudioUrl(URL.createObjectURL(uploadedFile)); 
      setView('analyzing'); 
      if (apiKey) analyzeWithGeminiAPI(uploadedFile); else handleMockAnalysis(); 
    }
  };

  const downloadCSV = () => {
    const headers = ["Criteria", "Weight", "Score", "Comments"];
    const rows = CRITERIA.map(c => [c.title, c.weight + "%", naFlags[c.id] ? "N/A" : scores[c.id], `"${comments[c.id].replace(/"/g, '""')}"`]);
    const summaryRow = ["OVERALL SCORE", "", calculateTotals().percentage + "%", `"${executiveSummary.replace(/"/g, '""')}"`];
    const csvContent = "data:text/csv;charset=utf-8," + `Analyst,${agentName},Date,${reviewDate}\n` + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n") + "\n" + summaryRow.join(",");
    const encodedUri = encodeURI(csvContent); const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", `Holcim_Audit_${agentName}_${reviewDate}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const totals = calculateTotals();

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-100"><div className="animate-spin rounded-full h-12 w-12 border-b-4" style={{ borderColor: BRAND.green }}></div></div>;
  if (!user) return <LoginScreen />;

  return (
    <div className="min-h-screen font-sans text-slate-800" style={{ backgroundColor: BRAND.grey }}>
      {showAdminPanel && <AdminUserCreator onClose={() => setShowAdminPanel(false)} />}
      
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm no-print">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
             <HolcimLogo className="h-10 md:h-12" />
             <div className="hidden md:block h-6 w-px bg-slate-300 mx-2"></div>
             <span className="hidden md:block text-slate-500 font-medium">Service Desk Coaching</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowAdminPanel(true)} className="p-2 rounded-full text-slate-400 hover:text-blue-600" title="Manage Users"><Users size={20} /></button>
            <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-full text-slate-400 hover:text-slate-600"><Settings size={20} /></button>
            <button onClick={handleLogout} className="p-2 rounded-full text-slate-400 hover:text-red-600" title="Sign Out"><LogOut size={20} /></button>
            {view === 'report' && <button onClick={() => setView('upload')} style={{ color: BRAND.green }} className="flex items-center gap-2 px-3 py-2 text-sm font-bold hover:bg-slate-50 rounded-lg"><RefreshCw size={16} /> New Audit</button>}
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="text-white p-6 shadow-inner" style={{ backgroundColor: BRAND.navy }}>
          <div className="max-w-5xl mx-auto flex items-center gap-4">
            <div className="flex-1"><h3 className="font-bold flex items-center gap-2"><Zap size={16} /> Google Gemini API Configuration</h3></div>
            <div className="flex gap-2"><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="px-4 py-2 rounded bg-white/10 text-white text-sm border border-white/20" placeholder="AIzaSy..." /><button onClick={() => setShowSettings(false)} style={{ backgroundColor: BRAND.green }} className="px-4 py-2 rounded text-sm font-bold hover:opacity-90">Done</button></div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-8">
        {view === 'upload' && (
          <div className="flex flex-col items-center justify-center py-12 animate-fade-in">
            {error && <div className="mb-6 bg-red-50 text-red-600 px-4 py-3 rounded-lg border border-red-200 flex items-center gap-2 max-w-lg w-full"><AlertCircle size={16} /> {error}</div>}
            <div className="bg-white p-12 rounded-2xl shadow-xl border border-slate-200 text-center max-w-lg w-full">
              <div className="flex justify-center mb-8"><div className="p-4 rounded-full bg-slate-50">{apiKey ? <ShieldCheck size={48} style={{ color: BRAND.green }} /> : <Upload size={48} style={{ color: BRAND.navy }} />}</div></div>
              <h2 className="text-2xl font-bold mb-2" style={{ color: BRAND.navy }}>Call Quality Audit</h2>
              <p className="text-slate-500 mb-8 text-sm">{apiKey ? 'Holcim UK Policy Strictness: HIGH (Gemini 1.5 Flash)' : 'Mock Mode Active'}</p>
              <div className="mb-6 text-left"><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Analyst Name</label><div className="relative"><User className="absolute left-3 top-3 text-slate-400" size={18} /><input type="text" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. Sarah Smith" className="w-full pl-10 pr-4 py-3 rounded-lg border border-slate-300 outline-none focus:ring-2" style={{ '--tw-ring-color': BRAND.green }} /></div></div>
              <label className="block w-full cursor-pointer group"><input type="file" accept=".wav,.mp3" className="hidden" onChange={handleUpload} /><div className="border-2 border-dashed border-slate-200 bg-slate-50 group-hover:bg-blue-50/50 group-hover:border-blue-200 transition-all rounded-xl p-8 flex flex-col items-center gap-3"><span className="font-semibold" style={{ color: BRAND.cyan }}>Click to upload recording</span></div></label>
            </div>
          </div>
        )}

        {view === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 mb-6" style={{ borderColor: BRAND.green }}></div>
            <h2 className="text-2xl font-bold" style={{ color: BRAND.navy }}>Auditing Call Quality...</h2>
            <p className="text-slate-500 mt-2">Processing with Google Gemini 1.5 Flash (Direct API)...</p>
          </div>
        )}

        {view === 'report' && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <div className="flex flex-col md:flex-row justify-between items-start border-b border-slate-100 pb-6 mb-6 gap-6">
                <div className="flex-1">
                  <div className="uppercase tracking-wide text-xs font-bold text-slate-400 mb-1">Holcim UK Quality Assurance</div>
                  <h1 className="text-3xl font-bold" style={{ color: BRAND.navy }}>Audit Summary</h1>
                  <div className="text-sm text-slate-500 mt-2 flex gap-4"><span className="flex items-center gap-1"><User size={14}/> Analyst: <b>{agentName}</b></span><span>•</span><span>Date: <b>{new Date().toLocaleDateString()}</b></span></div>
                </div>
                <div className="w-full md:w-1/3 bg-slate-50 p-4 rounded-xl border border-slate-200 no-print">
                  <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-500 uppercase"><Volume2 size={14} /> Call Recording</div>
                  <audio ref={audioRef} src={audioUrl} controls className="w-full h-8" />
                </div>
                <div className="text-right min-w-fit">
                   <div className="text-5xl font-bold" style={{ color: Number(totals.percentage) >= 85 ? BRAND.green : Number(totals.percentage) >= 60 ? '#EAB308' : '#DC2626' }}>{totals.percentage}%</div>
                   <div className="text-sm text-slate-500 mt-1">Total Compliance Score</div>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-8 mb-8">
                <div className="md:w-1/3 flex justify-center items-center bg-white border border-slate-100 rounded-xl p-2">
                   <RadarChart scores={scores} naFlags={naFlags} />
                </div>
                <div className="md:w-2/3 bg-slate-50 rounded-xl p-6 border border-slate-200">
                  <h3 className="text-sm font-bold uppercase tracking-wide mb-3 flex items-center gap-2" style={{ color: BRAND.navy }}><BarChart3 size={16} /> Executive Summary</h3>
                  <p className="text-slate-800 leading-relaxed text-base"><TimestampedText text={executiveSummary} onSeek={seekTo} /></p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="bg-green-50 p-6 rounded-xl border border-green-100">
                    <h3 className="font-bold flex items-center gap-2 mb-4 text-lg" style={{ color: '#166534' }}><CheckCircle size={20} /> Commendations</h3>
                    <ul className="space-y-3 text-sm text-green-900">{detailedStrengths.map((str, i) => <li key={i} className="flex gap-3 items-start"><span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: BRAND.green }}></span><span className="leading-relaxed"><TimestampedText text={str} onSeek={seekTo} /></span></li>)}</ul>
                 </div>
                 <div className="bg-red-50 p-6 rounded-xl border border-red-100">
                    <h3 className="font-bold text-red-800 flex items-center gap-2 mb-4 text-lg"><AlertCircle size={20} /> Required Actions</h3>
                    <ul className="space-y-3 text-sm text-red-900">{detailedImprovements.map((imp, i) => <li key={i} className="flex gap-3 items-start"><span className="mt-1.5 w-1.5 h-1.5 bg-red-600 rounded-full flex-shrink-0"></span><span className="leading-relaxed"><TimestampedText text={imp} onSeek={seekTo} /></span></li>)}</ul>
                 </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-8 py-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center"><span className="font-bold text-lg" style={{ color: BRAND.navy }}>Detailed Criteria Breakdown</span><span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Strict Policy Adherence</span></div>
              <div className="divide-y divide-slate-100">
                {CRITERIA.map((item) => (
                  <div key={item.id} className={`p-8 ${naFlags[item.id] ? 'opacity-50 bg-slate-50' : ''}`}>
                    <div className="flex flex-col md:flex-row gap-8">
                      <div className="md:w-1/4">
                        <h3 className="font-bold text-lg" style={{ color: BRAND.navy }}>{item.title}</h3>
                        <p className="text-xs text-slate-500 mt-1">Weight: {item.weight}%</p>
                        <div className={`mt-4 text-4xl font-bold`} style={{ color: scores[item.id] >= 3 ? BRAND.navy : '#DC2626' }}>{naFlags[item.id] ? '-' : scores[item.id]}<span className="text-lg text-slate-400 font-normal">/5</span></div>
                      </div>
                      <div className="md:w-3/4">
                        {!naFlags[item.id] ? (
                          <>
                            <div className="mb-4">
                              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Audit Justification</h4>
                              <div className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100 border-l-4" style={{ borderLeftColor: BRAND.green }}><TimestampedText text={comments[item.id] || "No justification provided."} onSeek={seekTo} /></div>
                            </div>
                            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-100 no-print"><span className="text-xs font-semibold text-slate-400">Adjust Score:</span><div className="flex gap-1">{[0,1,2,3,4,5].map(v => (<button key={v} onClick={() => setScores(prev => ({...prev, [item.id]: v}))} style={scores[item.id] === v ? { backgroundColor: BRAND.green, color: 'white' } : {}} className={`w-8 h-8 rounded font-bold text-sm transition-all ${scores[item.id] !== v ? 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50' : ''}`}>{v}</button>))}</div></div>
                          </>
                        ) : <p className="text-sm text-slate-400 italic mt-2">Marked Not Applicable.</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 print:break-inside-avoid">
               <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-4"><PenTool style={{ color: BRAND.green }} size={20} /><h2 className="text-xl font-bold" style={{ color: BRAND.navy }}>Coaching Agreement & Action Plan</h2></div>
               <p className="text-sm text-slate-500 mb-4">In accordance with policy Section 11, Agent and Manager must agree on specific next steps.</p>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-2"><label className="block text-xs font-bold text-slate-500 uppercase mb-2">Agreed Development Actions</label><textarea className="w-full border border-slate-200 rounded-lg p-3 text-sm h-32 focus:ring-2 outline-none" style={{ '--tw-ring-color': BRAND.green }} placeholder="E.g., Agent to shadow a senior analyst..." value={agreedAction} onChange={(e) => setAgreedAction(e.target.value)}></textarea></div>
                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-2">Next Review Date</label><input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="w-full border border-slate-200 rounded-lg p-3 text-sm mb-4" /><div className="border-t border-slate-100 pt-4 mt-4"><div className="flex items-center gap-2 mb-2"><div className="w-4 h-4 border-2 border-slate-300 rounded"></div><span className="text-sm text-slate-600">Analyst Signed</span></div><div className="flex items-center gap-2"><div className="w-4 h-4 border-2 rounded" style={{ backgroundColor: BRAND.green, borderColor: BRAND.green }}></div><span className="text-sm text-slate-600">Manager Signed</span></div></div></div>
               </div>
            </div>

            <div className="flex justify-end gap-4 no-print pb-10">
              <button onClick={downloadCSV} className="px-6 py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl flex items-center gap-2 hover:bg-slate-50"><FileSpreadsheet size={18} /> Export CSV</button>
              <button onClick={() => window.print()} style={{ backgroundColor: BRAND.green }} className="px-8 py-3 text-white font-bold rounded-xl flex items-center gap-2 shadow-lg hover:opacity-90 transition-all"><Printer size={18} /> Print PDF Report</button>
            </div>
          </div>
        )}
      </div>
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } .shadow-sm, .shadow-lg { box-shadow: none !important; } }`}</style>
    </div>
  );
}


