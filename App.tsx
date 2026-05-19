import React, { useState, useEffect, useMemo } from "react";
import { 
  Plus, 
  Search, 
  Link as LinkIcon, 
  Trash2, 
  Edit2, 
  ExternalLink, 
  CheckCircle, 
  Circle, 
  Calendar, 
  RefreshCw, 
  Download, 
  Upload, 
  Layout, 
  Settings,
  Bell,
  LogOut,
  ChevronRight,
  GripVertical,
  LogOut as LogOutIcon,
  LogIn,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, isPast, isWithinInterval, addDays, startOfToday } from "date-fns";
import { 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  setDoc,
  Timestamp
} from "firebase/firestore";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import { auth, db, signInWithGoogle, OperationType, handleFirestoreError } from "./lib/firebase";
import { Group, Task, FilterType } from "./types";
import { normalizeUrl, getReadableUrl, extractAndSaveVariables, replaceVariables } from "./lib/utils";
import Landing from "./components/layout/Landing";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"landing" | "app">("landing");
  const [authError, setAuthError] = useState<string | null>(null);
  
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [gasPrice, setGasPrice] = useState<number | null>(null);

  // Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        setView("app");
        setAuthError(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed. Please try again.");
    }
  };

  // Gas Price
  useEffect(() => {
    const fetchGas = async () => {
      try {
        const res = await fetch("/api/gas");
        const data = await res.json();
        if (data.result?.ProposeGasPrice) {
          setGasPrice(Number(data.result.ProposeGasPrice));
        }
      } catch (err) {
        console.error("Gas fetch error", err);
      }
    };
    fetchGas();
    const interval = setInterval(fetchGas, 30000);
    return () => clearInterval(interval);
  }, []);

  // Groups Listener
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "groups"), 
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const gList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Group));
      setGroups(gList);
      if (!activeGroupId && gList.length > 0) {
        setActiveGroupId(gList[0].id);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, "groups"));
    
    return () => unsubscribe();
  }, [user]);

  // Tasks Listener
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "tasks"), 
      where("userId", "==", user.uid),
      orderBy("order", "asc")
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task));
      setTasks(tList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, "tasks"));
    
    return () => unsubscribe();
  }, [user]);

  // --- Handlers ---
  const handleAddGroup = async () => {
    const name = prompt("Enter group name:");
    if (!name || !user) return;
    
    try {
      await addDoc(collection(db, "groups"), {
        name: name.toUpperCase(),
        userId: user.uid,
        dailyReset: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "groups");
    }
  };

  const handleAddUrl = async (urlInput: string) => {
    if (!urlInput || !user || !activeGroupId) return;
    
    const normalized = normalizeUrl(urlInput);
    const withVariables = extractAndSaveVariables(normalized);
    
    try {
      // Get metadata from our server API
      const metaRes = await fetch(`/api/metadata?url=${encodeURIComponent(replaceVariables(withVariables))}`);
      const meta = await metaRes.json();
      
      const newOrder = tasks.filter(t => t.groupId === activeGroupId).length;
      
      await addDoc(collection(db, "tasks"), {
        url: withVariables,
        title: meta.title || getReadableUrl(withVariables),
        favicon: meta.favicon || `https://www.google.com/s2/favicons?domain=${new URL(replaceVariables(withVariables)).hostname}&sz=64`,
        notes: "",
        completed: false,
        resetDaily: true,
        order: newOrder,
        userId: user.uid,
        groupId: activeGroupId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "tasks");
    }
  };

  const toggleTask = async (task: Task) => {
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        completed: !task.completed,
        completedAt: !task.completed ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm("Delete this task?")) return;
    try {
      await deleteDoc(doc(db, "tasks", taskId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `tasks/${taskId}`);
    }
  };

  const openAllActive = () => {
    const activeTasks = tasks.filter(t => t.groupId === activeGroupId && !t.completed);
    activeTasks.forEach(t => {
      window.open(replaceVariables(t.url), "_blank");
    });
  };

  // --- Derived ---
  const activeGroup = groups.find(g => g.id === activeGroupId);
  const filteredTasks = tasks.filter(t => {
    if (t.groupId !== activeGroupId) return false;
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase()) || 
                          t.url.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    // Add logic for due/expired if needed
    return true;
  });

  const progress = useMemo(() => {
    const groupTasks = tasks.filter(t => t.groupId === activeGroupId);
    if (groupTasks.length === 0) return 0;
    const done = groupTasks.filter(t => t.completed).length;
    return Math.round((done / groupTasks.length) * 100);
  }, [tasks, activeGroupId]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-page gap-4 text-accent">
        <RefreshCw size={40} className="animate-spin" />
        <p className="font-bold uppercase tracking-widest text-[10px]">Initializing DailyLink...</p>
      </div>
    );
  }

  if (view === "landing" && !user) {
    return (
      <div className="relative">
        <Landing onStart={handleSignIn} />
        {authError && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-6">
            <div className="bg-red-50 border border-red-200 p-6 rounded-2xl shadow-2xl space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-red-600 shrink-0">
                  <Bell size={20} />
                </div>
                <div>
                  <h3 className="text-red-900 font-bold">Sign-in issue detected</h3>
                  <p className="text-red-700 text-sm mt-1">{authError}</p>
                </div>
              </div>
              <div className="pt-2">
                <p className="text-xs text-red-600/70 font-medium">
                  Browsers often block popups in iframes. Click the "Open in new tab" icon at the top right of this preview and try again there.
                </p>
              </div>
              <button 
                onClick={() => setAuthError(null)}
                className="w-full py-2 bg-red-100 text-red-700 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-red-200 transition-colors"
                id="dismissError"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex bg-page h-screen overflow-hidden text-slate-800">
      {/* Sidebar */}
      <aside className="w-80 bg-panel-strong text-white flex flex-col shrink-0 border-r border-white/5">
        <header className="p-8 border-b border-white/10 bg-gradient-to-br from-accent/20 to-transparent">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center shadow-lg shadow-accent/20">
                <CheckCircle size={22} className="text-white" />
              </div>
              <span className="text-xl font-black tracking-tight">DailyLink</span>
            </div>
            <button onClick={() => signOut(auth)} className="text-white/40 hover:text-white transition-colors" title="Logout">
              <LogOutIcon size={18} />
            </button>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-extrabold text-white/40 uppercase tracking-widest">Workspace</p>
            <h2 className="text-2xl font-bold truncate">{user?.displayName || "Member"}</h2>
          </div>
          
          {gasPrice && (
            <div className={cn(
              "mt-5 flex items-center gap-2 px-3 py-2.5 rounded-2xl border border-white/10 bg-white/5",
              gasPrice < 20 ? "border-emerald-500/30 text-emerald-400" : 
              gasPrice < 55 ? "border-amber-500/30 text-amber-400" : "border-red-500/30 text-red-400"
            )}>
              <div className="flex items-center gap-2 overflow-hidden text-xs font-bold uppercase tracking-wider">
                <Zap size={14} fill="currentColor" />
                <span>{gasPrice} Gwei</span>
              </div>
            </div>
          )}
        </header>

        <nav className="flex-1 overflow-y-auto p-4 space-y-8">
          <div>
            <div className="flex items-center justify-between px-3 mb-4">
              <p className="text-[10px] font-extrabold text-white/40 uppercase tracking-widest">Your Groups</p>
              <button 
                onClick={handleAddGroup}
                className="w-6 h-6 flex items-center justify-center bg-accent/20 hover:bg-accent text-accent hover:text-white rounded-lg transition-all"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-1.5">
              {groups.length > 0 ? groups.map(group => (
                <button
                  key={group.id}
                  onClick={() => setActiveGroupId(group.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all text-sm font-bold group",
                    activeGroupId === group.id 
                      ? "bg-accent text-white shadow-xl shadow-accent/20" 
                      : "text-white/50 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <span className="truncate">{group.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full",
                      activeGroupId === group.id ? "bg-white/20 text-white" : "bg-white/10 text-white/40"
                    )}>
                      {tasks.filter(t => t.groupId === group.id).length}
                    </span>
                    <Trash2 
                      size={14} 
                      className="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity" 
                      onClick={(e) => {
                        e.stopPropagation();
                        // Add delete group logic
                      }}
                    />
                  </div>
                </button>
              )) : (
                <div className="p-10 text-center border-2 border-dashed border-white/5 rounded-2xl">
                  <p className="text-xs font-bold text-white/20">No groups yet</p>
                </div>
              )}
            </div>
          </div>
          
          <div className="pt-6 border-t border-white/10">
            <p className="px-3 mb-4 text-[10px] font-extrabold text-white/40 uppercase tracking-widest">Utility</p>
            <div className="grid grid-cols-2 gap-3">
              <button className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all text-white/60 hover:text-white group">
                <Upload size={18} className="text-accent group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-black uppercase tracking-widest">Import</span>
              </button>
              <button className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all text-white/60 hover:text-white group">
                <Download size={18} className="text-accent group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-black uppercase tracking-widest">Export</span>
              </button>
            </div>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="p-10 border-b border-line flex items-center justify-between gap-8 bg-white/80 backdrop-blur-xl">
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] font-black text-accent uppercase tracking-[0.2em] mb-2">
              Current Group
            </p>
            <h1 className="text-5xl font-black text-slate-900 tracking-tight leading-none">
              {activeGroup?.name || "Choose a group"}
            </h1>
            <p className="text-slate-400 font-medium text-lg">
              {activeGroup ? (activeGroup.dailyReset ? "Start fresh every 24 hours." : "Consistency is the key.") : "Select a collection on the left."}
            </p>
          </div>
          
          <div className="flex gap-10 shrink-0">
            <div className="text-right space-y-2">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Health Score</p>
              <div className="flex items-center gap-4">
                 <span className="text-4xl font-black tabular-nums tracking-tighter">
                  {progress}%
                </span>
                <div className="w-40 h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner flex">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-accent relative"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20" />
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="p-10 space-y-8 flex-1 overflow-y-auto">
          <div className="flex flex-wrap items-end gap-6 bg-white p-8 rounded-[32px] border border-line shadow-sm">
            <div className="flex-1 min-w-[300px] space-y-2">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Quick Link</label>
              <div className="relative group">
                <LinkIcon size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-accent transition-colors" />
                <input 
                  type="text" 
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddUrl((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                  placeholder="Paste URL and press Enter..."
                  className="w-full bg-slate-50/50 border border-line rounded-2xl py-4.5 pl-14 pr-6 focus:outline-none focus:ring-4 focus:ring-accent/10 focus:border-accent transition-all font-bold text-lg"
                />
              </div>
            </div>
            
            <div className="w-80 space-y-2">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Global Query</label>
              <div className="relative group">
                <Search size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-accent transition-colors" />
                <input 
                  type="text" 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter tasks..."
                  className="w-full bg-slate-50/50 border border-line rounded-2xl py-4.5 pl-14 pr-6 focus:outline-none focus:ring-4 focus:ring-accent/10 focus:border-accent transition-all font-bold text-lg"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex bg-white p-1.5 rounded-2xl border border-line shadow-sm">
              {(["all", "active", "completed"] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-6 py-2.5 rounded-[10px] text-xs font-black uppercase tracking-widest transition-all",
                    filter === f 
                      ? "bg-accent text-white shadow-lg shadow-accent/20" 
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Automations</p>
                <div className="h-4 w-px bg-line" />
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={cn(
                    "w-12 h-6 rounded-full transition-all flex items-center p-1",
                    activeGroup?.dailyReset ? "bg-accent" : "bg-slate-200"
                  )}>
                    <motion.div 
                      layout
                      animate={{ x: activeGroup?.dailyReset ? 24 : 0 }}
                      className="w-4 h-4 bg-white rounded-full shadow-md"
                    />
                  </div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-accent transition-colors">Daily Resync</span>
                </label>
              </div>
              
              <button 
                onClick={openAllActive}
                disabled={filteredTasks.length === 0} 
                className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-accent transition-all disabled:opacity-20 disabled:cursor-not-allowed shadow-xl shadow-slate-900/10 active:scale-95"
              >
                <ExternalLink size={16} />
                <span>Blast Open All</span>
              </button>
            </div>
          </div>

          <div className="space-y-4 pb-20">
            <AnimatePresence mode="popLayout" initial={false}>
              {filteredTasks.length > 0 ? (
                filteredTasks.map((task) => (
                  <motion.div
                    key={task.id}
                    layoutId={task.id}
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, x: -20 }}
                    className={cn(
                      "group flex items-center gap-6 p-6 bg-white border border-line rounded-3xl hover:border-accent/40 hover:shadow-2xl hover:shadow-accent/5 transition-all relative overflow-hidden",
                      task.completed && "bg-slate-50/50"
                    )}
                  >
                     <div className="w-1.5 h-full absolute left-0 top-0 bg-transparent group-hover:bg-accent/40 transition-colors" />
                    
                    <div className="cursor-grab text-slate-200 hover:text-accent transition-colors shrink-0">
                      <GripVertical size={24} />
                    </div>

                    <button 
                      onClick={() => toggleTask(task)}
                      className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0",
                        task.completed 
                          ? "bg-accent text-white shadow-lg shadow-accent/20" 
                          : "border-2 border-slate-100 text-transparent hover:border-accent/50 hover:bg-accent/5"
                      )}
                    >
                      <CheckCircle size={18} />
                    </button>
                    
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 p-2.5 shrink-0 shadow-inner flex items-center justify-center border border-line">
                      <img 
                        src={task.favicon} 
                        alt="" 
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://www.google.com/s2/favicons?domain=${new URL(replaceVariables(task.url)).hostname}&sz=64`;
                        }}
                      />
                    </div>
                    
                    <div className="flex-1 min-w-0 space-y-1">
                      <a 
                        href={replaceVariables(task.url)} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className={cn(
                          "text-xl font-black block truncate hover:text-accent transition-colors tracking-tight",
                          task.completed && "text-slate-400 line-through decoration-[3px]"
                        )}
                      >
                        {task.title}
                      </a>
                      <div className="flex items-center gap-3">
                        <p className="text-xs text-slate-400 font-bold truncate tracking-wide">{getReadableUrl(task.url)}</p>
                        {task.notes && (
                          <>
                            <div className="w-1 h-1 bg-slate-200 rounded-full" />
                            <p className="text-xs text-slate-500 font-medium truncate italic">“{task.notes}”</p>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0">
                      <button className="p-3 text-slate-300 hover:text-accent hover:bg-accent/10 rounded-xl transition-all">
                        <Edit2 size={20} />
                      </button>
                      <button 
                        onClick={() => deleteTask(task.id)}
                        className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="py-24 text-center space-y-6">
                  <div className="w-24 h-24 bg-slate-50 rounded-[40px] flex items-center justify-center mx-auto text-slate-200 shadow-inner">
                    <Layout size={40} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black text-slate-800 tracking-tight">System holds no entries</h3>
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Filter: {filter} / Query: {search || "None"}</p>
                  </div>
                  <button onClick={() => setSearch("")} className="text-accent font-black uppercase tracking-widest text-[10px] hover:underline">Clear Search</button>
                </div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </main>
    </div>
  );
}
