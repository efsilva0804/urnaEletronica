import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { collection, onSnapshot, query, orderBy, doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { Candidate, Voter, UrnaStatus, AuditLog } from './types';
import { VotingMachine } from './components/VotingMachine';
import { AdminDashboard } from './components/AdminDashboard';
import { ResultsDashboard } from './components/ResultsDashboard';
import { Shield, Vote as VoteIcon, LayoutDashboard, LogOut, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState<'VOTING' | 'ADMIN' | 'RESULTS'>('VOTING');
  const [urnaStatus, setUrnaStatus] = useState<UrnaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAdmin(u?.email === 'eniofds@gmail.com');
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const statusRef = doc(db, 'urnaStatus', 'global');
    const unsubscribe = onSnapshot(statusRef, (docSnap) => {
      if (docSnap.exists()) {
        setUrnaStatus(docSnap.data() as UrnaStatus);
      } else if (isAdmin) {
        // Initialize status if not exists (only admin can do this)
        setDoc(statusRef, { isOpen: false });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'urnaStatus/global');
    });
    return () => unsubscribe();
  }, [user, isAdmin]);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    
    setIsLoggingIn(true);
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/popup-blocked') {
        setLoginError('O navegador bloqueou a janela de login. Por favor, permita popups para este site.');
      } else if (error.code === 'auth/cancelled-popup-request') {
        setLoginError('Uma solicitação de login já está em andamento.');
      } else if (error.code === 'auth/popup-closed-by-user') {
        setLoginError('A janela de login foi fechada antes da conclusão.');
      } else {
        setLoginError('Ocorreu um erro ao tentar fazer login. Tente novamente.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => auth.signOut();

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl"
        >
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Shield className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Urna Eletrônica</h1>
          <p className="text-zinc-400 mb-8 italic serif">Sistema Escolar Auditável de Votação</p>
          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            className={`w-full ${isLoggingIn ? 'bg-zinc-700 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'} text-white font-semibold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20`}
          >
            {isLoggingIn ? (
              <>
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                />
                Entrando...
              </>
            ) : (
              'Acessar com Google'
            )}
          </button>
          
          <AnimatePresence>
            {loginError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm"
              >
                {loginError}
              </motion.div>
            )}
          </AnimatePresence>
          <p className="mt-6 text-xs text-zinc-500 uppercase tracking-widest">Integridade Garantida por Hashing</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Navigation Bar */}
      <nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-emerald-500" />
              <span className="font-bold text-lg hidden sm:block">URNA AUDITÁVEL</span>
            </div>
            
            <div className="flex items-center gap-1 sm:gap-4">
              <button
                onClick={() => setView('VOTING')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${view === 'VOTING' ? 'bg-emerald-500/10 text-emerald-500' : 'text-zinc-400 hover:text-white'}`}
              >
                <VoteIcon className="w-5 h-5" />
                <span className="hidden md:block">Votação</span>
              </button>
              
              <button
                onClick={() => setView('RESULTS')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${view === 'RESULTS' ? 'bg-emerald-500/10 text-emerald-500' : 'text-zinc-400 hover:text-white'}`}
              >
                <LayoutDashboard className="w-5 h-5" />
                <span className="hidden md:block">Resultados</span>
              </button>

              {isAdmin && (
                <button
                  onClick={() => setView('ADMIN')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${view === 'ADMIN' ? 'bg-emerald-500/10 text-emerald-500' : 'text-zinc-400 hover:text-white'}`}
                >
                  <Lock className="w-5 h-5" />
                  <span className="hidden md:block">Admin</span>
                </button>
              )}

              <div className="h-6 w-px bg-zinc-800 mx-2" />

              <button
                onClick={handleLogout}
                className="p-2 text-zinc-400 hover:text-red-400 transition-colors"
                title="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          {view === 'VOTING' && (
            <motion.div
              key="voting"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <VotingMachine urnaStatus={urnaStatus} />
            </motion.div>
          )}
          
          {view === 'ADMIN' && isAdmin && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <AdminDashboard />
            </motion.div>
          )}

          {view === 'RESULTS' && (
            <motion.div
              key="results"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <ResultsDashboard isAdmin={isAdmin} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Status */}
      <footer className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 px-4 py-2 text-xs flex justify-between items-center z-50">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${urnaStatus?.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-zinc-500 uppercase tracking-tighter">
            Status: {urnaStatus?.isOpen ? 'Urna Aberta' : 'Urna Fechada'}
          </span>
        </div>
        <div className="text-zinc-600 font-mono">
          v1.0.0-audit-chain
        </div>
      </footer>
    </div>
  );
}
