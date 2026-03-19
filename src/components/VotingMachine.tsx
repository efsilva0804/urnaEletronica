import React, { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Candidate, Voter, UrnaStatus } from '../types';
import { registerVote } from '../services/votingService';
import { User, Hash, CheckCircle2, AlertCircle, Shield, ChevronRight, Search, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function VotingMachine({ urnaStatus }: { urnaStatus: UrnaStatus | null }) {
  const [step, setStep] = useState<'CLASS' | 'VOTER_LIST' | 'VOTE' | 'SUCCESS'>('CLASS');
  const [selectedClass, setSelectedClass] = useState('');
  const [voter, setVoter] = useState<Voter | null>(null);
  const [candidateNumber, setCandidateNumber] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const unsubCandidates = onSnapshot(collection(db, 'candidates'), (snapshot) => {
      setCandidates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Candidate)));
    });
    const unsubVoters = onSnapshot(collection(db, 'voters'), (snapshot) => {
      setVoters(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Voter)));
    });
    return () => {
      unsubCandidates();
      unsubVoters();
    };
  }, []);

  useEffect(() => {
    if (candidateNumber.length === 2) {
      const found = candidates.find(c => c.number === candidateNumber);
      setSelectedCandidate(found || null);
    } else {
      setSelectedCandidate(null);
    }
  }, [candidateNumber, candidates]);

  const classes = [...new Set(voters.map(v => v.class))].sort();
  const filteredVoters = voters
    .filter(v => v.class === selectedClass && !v.voted)
    .filter(v => v.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleSelectVoter = (v: Voter) => {
    if (!urnaStatus?.isOpen) {
      setError('A votação está encerrada no momento.');
      return;
    }
    setVoter(v);
    setStep('VOTE');
  };

  const handleVote = async () => {
    if (!voter) return;
    setIsSubmitting(true);
    try {
      const voteId = selectedCandidate ? selectedCandidate.id : (candidateNumber === '00' ? 'BLANK' : 'NULL');
      await registerVote(voteId, voter.id);
      setStep('SUCCESS');
      setTimeout(() => {
        setStep('CLASS');
        setSelectedClass('');
        setVoter(null);
        setCandidateNumber('');
        setSelectedCandidate(null);
        setIsSubmitting(false);
        setSearchTerm('');
      }, 3000);
    } catch (err) {
      console.error(err);
      setError('Erro ao registrar voto. Tente novamente.');
      setIsSubmitting(false);
    }
  };

  const appendNumber = (num: string) => {
    if (candidateNumber.length < 2) {
      setCandidateNumber(prev => prev + num);
    }
  };

  const clearNumber = () => setCandidateNumber('');

  if (step === 'SUCCESS') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-emerald-500/20"
        >
          <CheckCircle2 className="w-12 h-12 text-white" />
        </motion.div>
        <h2 className="text-4xl font-black text-white mb-2">FIM</h2>
        <p className="text-zinc-400">Seu voto foi computado e criptografado com sucesso.</p>
        <div className="mt-8 p-4 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Hash className="w-4 h-4 text-emerald-500" />
          <span className="text-xs font-mono text-zinc-500">BOLETIM DE URNA ATUALIZADO</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <AnimatePresence mode="wait">
        {step === 'CLASS' && (
          <motion.div
            key="class-step"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl"
          >
            <div className="text-center mb-8">
              <Users className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white">Selecione sua Turma</h2>
              <p className="text-zinc-500 mt-2">Escolha a turma para encontrar seu nome</p>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {classes.map(c => (
                <button
                  key={c}
                  onClick={() => { setSelectedClass(c); setStep('VOTER_LIST'); }}
                  className="bg-zinc-950 border border-zinc-800 hover:border-emerald-500/50 p-6 rounded-2xl text-center transition-all group"
                >
                  <span className="text-xl font-bold text-zinc-300 group-hover:text-emerald-500">{c}</span>
                </button>
              ))}
              {classes.length === 0 && (
                <div className="col-span-full py-12 text-center text-zinc-600 italic">
                  Nenhuma turma cadastrada.
                </div>
              )}
            </div>
          </motion.div>
        )}

        {step === 'VOTER_LIST' && (
          <motion.div
            key="voter-list-step"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl flex flex-col h-[600px]"
          >
            <div className="flex items-center justify-between mb-6">
              <button onClick={() => setStep('CLASS')} className="text-zinc-500 hover:text-white flex items-center gap-2 text-sm">
                <ChevronRight className="w-4 h-4 rotate-180" /> Voltar
              </button>
              <h2 className="text-xl font-bold text-white">Turma: {selectedClass}</h2>
              <div className="w-10" />
            </div>

            <div className="relative mb-6">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
              <input
                type="text"
                placeholder="Buscar seu nome..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-12 pr-6 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
              />
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
              {filteredVoters.map(v => (
                <button
                  key={v.id}
                  onClick={() => handleSelectVoter(v)}
                  className="w-full bg-zinc-950 border border-zinc-800 hover:border-emerald-500/50 p-4 rounded-xl text-left flex items-center justify-between group transition-all"
                >
                  <span className="font-medium text-zinc-300 group-hover:text-white">{v.name}</span>
                  <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-emerald-500" />
                </button>
              ))}
              {filteredVoters.length === 0 && (
                <div className="py-12 text-center text-zinc-600 italic">
                  {searchTerm ? 'Nenhum aluno encontrado com esse nome.' : 'Todos os alunos desta turma já votaram!'}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {step === 'VOTE' && (
          <motion.div
            key="vote-step"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-8"
          >
            {/* Urna Screen */}
            <div className="bg-zinc-100 rounded-lg p-6 shadow-inner flex flex-col min-h-[400px] text-zinc-900">
              <div className="flex justify-between items-start border-b border-zinc-300 pb-4 mb-6">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Justiça Eleitoral Escolar</h3>
                  <h2 className="text-xl font-black">CANDIDATO</h2>
                </div>
                <div className="w-12 h-12 bg-zinc-200 rounded flex items-center justify-center">
                  <Shield className="w-6 h-6 text-zinc-400" />
                </div>
              </div>

              <div className="mb-4 p-2 bg-zinc-200 rounded text-[10px] font-bold text-zinc-600 uppercase">
                Eleitor: {voter?.name}
              </div>

              <div className="flex-1 flex gap-6">
                <div className="flex-1 space-y-4">
                  <div>
                    <span className="text-xs font-bold text-zinc-400 block">NÚMERO:</span>
                    <div className="flex gap-2 mt-1">
                      <div className="w-10 h-12 border-2 border-zinc-400 flex items-center justify-center text-2xl font-bold">
                        {candidateNumber[0] || ''}
                      </div>
                      <div className="w-10 h-12 border-2 border-zinc-400 flex items-center justify-center text-2xl font-bold">
                        {candidateNumber[1] || ''}
                      </div>
                    </div>
                  </div>

                  {candidateNumber.length === 2 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                      <div>
                        <span className="text-xs font-bold text-zinc-400 block">NOME:</span>
                        <span className="text-lg font-bold uppercase">{selectedCandidate ? selectedCandidate.name : 'VOTO NULO'}</span>
                      </div>
                      {selectedCandidate && (
                        <div>
                          <span className="text-xs font-bold text-zinc-400 block">PARTIDO:</span>
                          <span className="text-md font-semibold">{selectedCandidate.party}</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>

                <div className="w-32 h-40 bg-zinc-200 border border-zinc-300 rounded overflow-hidden flex items-center justify-center">
                  {selectedCandidate?.photoUrl ? (
                    <img src={selectedCandidate.photoUrl} alt="Foto" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <User className="w-12 h-12 text-zinc-400" />
                  )}
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-zinc-300 text-[10px] leading-tight text-zinc-500">
                Aperte a tecla:<br />
                <span className="font-bold text-emerald-600">VERDE</span> para CONFIRMAR<br />
                <span className="font-bold text-orange-500">LARANJA</span> para CORRIGIR<br />
                <span className="font-bold text-zinc-400">BRANCO</span> para VOTO EM BRANCO
              </div>
            </div>

            {/* Keypad */}
            <div className="bg-zinc-800 rounded-2xl p-6 shadow-2xl border border-zinc-700">
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                  <button
                    key={n}
                    onClick={() => appendNumber(n.toString())}
                    className="h-16 bg-zinc-900 hover:bg-zinc-950 text-white text-2xl font-bold rounded-lg border-b-4 border-black active:border-b-0 active:translate-y-1 transition-all"
                  >
                    {n}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => appendNumber('0')}
                  className="h-16 bg-zinc-900 hover:bg-zinc-950 text-white text-2xl font-bold rounded-lg border-b-4 border-black active:border-b-0 active:translate-y-1 transition-all"
                >
                  0
                </button>
                <div />
              </div>

              <div className="grid grid-cols-3 gap-3 mt-6">
                <button
                  onClick={() => { setCandidateNumber('00'); setSelectedCandidate(null); }}
                  className="h-14 bg-white hover:bg-zinc-100 text-zinc-900 text-xs font-bold rounded uppercase border-b-4 border-zinc-300 active:border-b-0 active:translate-y-1 transition-all"
                >
                  Branco
                </button>
                <button
                  onClick={clearNumber}
                  className="h-14 bg-orange-500 hover:bg-orange-400 text-white text-xs font-bold rounded uppercase border-b-4 border-orange-700 active:border-b-0 active:translate-y-1 transition-all"
                >
                  Corrige
                </button>
                <button
                  onClick={handleVote}
                  disabled={isSubmitting || (candidateNumber.length < 2 && candidateNumber !== '00')}
                  className="h-14 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded uppercase border-b-4 border-emerald-800 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center gap-2"
                >
                  {isSubmitting ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : 'Confirma'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
