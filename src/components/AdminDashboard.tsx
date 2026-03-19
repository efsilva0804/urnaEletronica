import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Candidate, Voter, AuditLog, UrnaStatus } from '../types';
import { verifyChainIntegrity } from '../services/votingService';
import { Plus, Trash2, ShieldCheck, ShieldAlert, History, Users, UserPlus, Power, PowerOff, RefreshCw, FileText, FileJson, Upload, Download, FileUp } from 'lucide-react';
import { jsPDF } from 'jspdf';
import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { motion } from 'motion/react';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export function AdminDashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [urnaStatus, setUrnaStatus] = useState<UrnaStatus | null>(null);
  const [integrity, setIntegrity] = useState<{ isValid: boolean; brokenAt?: string } | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const candidateFileRef = useRef<HTMLInputElement>(null);
  const voterFileRef = useRef<HTMLInputElement>(null);

  // Form states
  const [newCandidate, setNewCandidate] = useState({ name: '', number: '', party: '', photoUrl: '' });
  const [newVoter, setNewVoter] = useState({ ra: '', name: '', class: '' });

  useEffect(() => {
    const unsubCandidates = onSnapshot(collection(db, 'candidates'), (snap) => {
      setCandidates(snap.docs.map(d => ({ id: d.id, ...d.data() } as Candidate)));
    });
    const unsubVoters = onSnapshot(collection(db, 'voters'), (snap) => {
      setVoters(snap.docs.map(d => ({ id: d.id, ...d.data() } as Voter)));
    });
    const unsubLogs = onSnapshot(query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc')), (snap) => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLog)));
    });
    const unsubStatus = onSnapshot(doc(db, 'urnaStatus', 'global'), (snap) => {
      if (snap.exists()) setUrnaStatus(snap.data() as UrnaStatus);
    });

    return () => {
      unsubCandidates();
      unsubVoters();
      unsubLogs();
      unsubStatus();
    };
  }, []);

  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDoc(collection(db, 'candidates'), { ...newCandidate, votesCount: 0 });
    setNewCandidate({ name: '', number: '', party: '', photoUrl: '' });
  };

  const handleAddVoter = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDoc(collection(db, 'voters'), { ...newVoter, voted: false });
    setNewVoter({ ra: '', name: '', class: '' });
  };

  const handleImportCandidates = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = async () => {
        const typedarray = new Uint8Array(reader.result as ArrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          fullText += pageText + '\n';
        }
        
        // Simple heuristic for candidates: "Name Number Party"
        // This is very basic and might need adjustment based on PDF layout
        const lines = fullText.split('\n');
        const batch = writeBatch(db);
        lines.forEach(line => {
          const match = line.match(/(.+)\s+(\d{2})\s+(.+)/);
          if (match) {
            const docRef = doc(collection(db, 'candidates'));
            batch.set(docRef, {
              name: match[1].trim(),
              number: match[2],
              party: match[3].trim(),
              photoUrl: '',
              votesCount: 0
            });
          }
        });
        await batch.commit();
        alert('Candidatos importados do PDF com sucesso!');
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const batch = writeBatch(db);
        results.data.forEach((row: any) => {
          if (row.name && row.number) {
            const docRef = doc(collection(db, 'candidates'));
            batch.set(docRef, {
              name: row.name,
              number: row.number,
              party: row.party || '',
              photoUrl: row.photoUrl || '',
              votesCount: 0
            });
          }
        });
        await batch.commit();
        alert('Candidatos importados com sucesso!');
        if (candidateFileRef.current) candidateFileRef.current.value = '';
      }
    });
  };

  const handleImportVoters = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = async () => {
        const typedarray = new Uint8Array(reader.result as ArrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          fullText += pageText + '\n';
        }

        const lines = fullText.split('\n');
        const batch = writeBatch(db);
        let currentClass = 'Geral';
        
        lines.forEach(line => {
          if (line.includes('Turma:')) {
            currentClass = line.split('Turma:')[1].trim();
          } else {
            // Match RA - Name pattern
            const match = line.match(/(\d+)\s*-\s*([^\[]+)/);
            if (match) {
              const docRef = doc(collection(db, 'voters'));
              batch.set(docRef, {
                ra: match[1].trim(),
                name: match[2].trim(),
                class: currentClass,
                voted: false
              });
            }
          }
        });
        await batch.commit();
        alert('Eleitores importados do PDF com sucesso!');
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const batch = writeBatch(db);
        results.data.forEach((row: any) => {
          if (row.ra && row.name && row.class) {
            const docRef = doc(collection(db, 'voters'));
            batch.set(docRef, {
              ra: row.ra,
              name: row.name,
              class: row.class,
              voted: false
            });
          }
        });
        await batch.commit();
        alert('Eleitores importados com sucesso!');
        if (voterFileRef.current) voterFileRef.current.value = '';
      }
    });
  };

  const downloadTemplate = (type: 'candidates' | 'voters') => {
    let csv = '';
    if (type === 'candidates') {
      csv = 'name,number,party,photoUrl\nCandidato Exemplo,99,Partido Exemplo,https://link-da-foto.jpg';
    } else {
      csv = 'ra,name,class\n2024001,Aluno Exemplo,3A';
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${type}.csv`;
    a.click();
  };

  const toggleUrna = async () => {
    const statusRef = doc(db, 'urnaStatus', 'global');
    const newState = !urnaStatus?.isOpen;
    await updateDoc(statusRef, { 
      isOpen: newState,
      [newState ? 'startTime' : 'endTime']: new Date().toISOString()
    });
    
    await addDoc(collection(db, 'auditLogs'), {
      event: newState ? 'URNA_ABERTA' : 'URNA_FECHADA',
      timestamp: new Date().toISOString(),
      details: `Urna ${newState ? 'aberta' : 'fechada'} pelo administrador.`
    });
  };

  const checkIntegrity = async () => {
    setIsChecking(true);
    const result = await verifyChainIntegrity();
    setIntegrity(result);
    setIsChecking(false);
  };

  const exportVotersPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Lista de Eleitores - Urna Escolar', 20, 20);
    doc.setFontSize(10);
    let y = 30;
    
    // Group by class
    const classes = [...new Set(voters.map(v => v.class))].sort();
    
    classes.forEach(className => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.text(`Turma: ${className}`, 20, y);
      y += 7;
      doc.setFontSize(10);
      
      const classVoters = voters.filter(v => v.class === className).sort((a, b) => a.name.localeCompare(b.name));
      classVoters.forEach(v => {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(`${v.ra} - ${v.name} [${v.voted ? 'VOTOU' : 'Pendente'}]`, 30, y);
        y += 5;
      });
      y += 5;
    });
    
    doc.save(`lista_eleitores_${new Date().getTime()}.pdf`);
  };

  const exportVotersTXT = () => {
    let content = "LISTA DE ELEITORES - URNA ESCOLAR\n";
    content += `Data: ${new Date().toLocaleString()}\n\n`;
    
    const classes = [...new Set(voters.map(v => v.class))].sort();
    classes.forEach(className => {
      content += `TURMA: ${className}\n`;
      content += "------------------------------------------\n";
      const classVoters = voters.filter(v => v.class === className).sort((a, b) => a.name.localeCompare(b.name));
      classVoters.forEach(v => {
        content += `${v.ra.padEnd(10)} | ${v.name.padEnd(30)} | ${v.voted ? 'VOTOU' : 'Pendente'}\n`;
      });
      content += "\n";
    });
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lista_eleitores_${new Date().getTime()}.txt`;
    a.click();
  };

  return (
    <div className="space-y-12">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
        <div>
          <h1 className="text-3xl font-bold text-white">Painel de Controle</h1>
          <p className="text-zinc-500">Administração e Auditoria da Eleição</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={checkIntegrity}
            disabled={isChecking}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${integrity?.isValid ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/50' : integrity?.isValid === false ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'bg-zinc-800 text-zinc-300'}`}
          >
            {isChecking ? <RefreshCw className="w-5 h-5 animate-spin" /> : integrity?.isValid ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
            {isChecking ? 'Verificando...' : integrity ? (integrity.isValid ? 'Integridade OK' : 'Falha na Cadeia') : 'Verificar Integridade'}
          </button>
          
          <button
            onClick={toggleUrna}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${urnaStatus?.isOpen ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
          >
            {urnaStatus?.isOpen ? <PowerOff className="w-5 h-5" /> : <Power className="w-5 h-5" />}
            {urnaStatus?.isOpen ? 'Encerrar Votação' : 'Abrir Votação'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Candidates Section */}
        <div className="xl:col-span-2 space-y-8">
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-500" />
                Candidatos
              </h2>
              <div className="flex gap-2">
                <button 
                  onClick={() => downloadTemplate('candidates')}
                  className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Baixar Template CSV"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => candidateFileRef.current?.click()}
                  className="p-2 text-zinc-500 hover:text-emerald-500 transition-colors"
                  title="Importar CSV ou PDF"
                >
                  <FileUp className="w-4 h-4" />
                </button>
                <input 
                  type="file" 
                  ref={candidateFileRef} 
                  onChange={handleImportCandidates} 
                  accept=".csv,.pdf" 
                  className="hidden" 
                />
              </div>
            </div>
            <div className="p-6">
              <form onSubmit={handleAddCandidate} className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
                <input
                  placeholder="Nome"
                  value={newCandidate.name}
                  onChange={e => setNewCandidate({...newCandidate, name: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  required
                />
                <input
                  placeholder="Nº"
                  maxLength={2}
                  value={newCandidate.number}
                  onChange={e => setNewCandidate({...newCandidate, number: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  required
                />
                <input
                  placeholder="Partido"
                  value={newCandidate.party}
                  onChange={e => setNewCandidate({...newCandidate, party: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  required
                />
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {candidates.map(c => (
                  <div key={c.id} className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex items-center gap-4 group">
                    <div className="w-12 h-12 bg-zinc-900 rounded-lg overflow-hidden flex items-center justify-center">
                      {c.photoUrl ? <img src={c.photoUrl} alt="" className="w-full h-full object-cover" /> : <Users className="w-6 h-6 text-zinc-700" />}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-sm">{c.name}</h3>
                      <p className="text-xs text-zinc-500">{c.number} - {c.party}</p>
                    </div>
                    <button onClick={() => deleteDoc(doc(db, 'candidates', c.id))} className="p-2 text-zinc-700 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Voters Section */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-500" />
                Eleitores Permitidos
              </h2>
              <div className="flex gap-2">
                <button 
                  onClick={() => downloadTemplate('voters')}
                  className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Baixar Template CSV"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => voterFileRef.current?.click()}
                  className="p-2 text-zinc-500 hover:text-emerald-500 transition-colors"
                  title="Importar CSV ou PDF"
                >
                  <FileUp className="w-4 h-4" />
                </button>
                <input 
                  type="file" 
                  ref={voterFileRef} 
                  onChange={handleImportVoters} 
                  accept=".csv,.pdf" 
                  className="hidden" 
                />
                <button onClick={exportVotersPDF} className="p-2 text-zinc-400 hover:text-red-400 transition-colors" title="Exportar PDF">
                  <FileText className="w-5 h-5" />
                </button>
                <button onClick={exportVotersTXT} className="p-2 text-zinc-400 hover:text-emerald-400 transition-colors" title="Exportar TXT">
                  <FileJson className="w-5 h-5" />
                </button>
                <span className="text-xs text-zinc-500 uppercase tracking-widest self-center ml-2">{voters.length} Registrados</span>
              </div>
            </div>
            <div className="p-6">
              <form onSubmit={handleAddVoter} className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
                <input
                  placeholder="RA"
                  value={newVoter.ra}
                  onChange={e => setNewVoter({...newVoter, ra: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  required
                />
                <input
                  placeholder="Nome"
                  value={newVoter.name}
                  onChange={e => setNewVoter({...newVoter, name: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  required
                />
                <input
                  placeholder="Turma"
                  value={newVoter.class}
                  onChange={e => setNewVoter({...newVoter, class: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  required
                />
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </form>

              <div className="max-h-[400px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {voters.map(v => (
                  <div key={v.id} className="bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-lg flex items-center justify-between text-sm">
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-emerald-500">{v.ra}</span>
                      <span className="font-medium">{v.name}</span>
                      <span className="text-zinc-600 text-xs">{v.class}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${v.voted ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-800 text-zinc-500'}`}>
                        {v.voted ? 'Votou' : 'Pendente'}
                      </span>
                      <button onClick={() => deleteDoc(doc(db, 'voters', v.id))} className="text-zinc-700 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Audit Logs Section */}
        <div className="space-y-8">
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden h-full flex flex-col">
            <div className="p-6 border-b border-zinc-800 flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-500" />
              <h2 className="text-xl font-bold">Log de Auditoria</h2>
            </div>
            <div className="flex-1 p-6 overflow-y-auto max-h-[800px] custom-scrollbar">
              <div className="space-y-6 relative before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-px before:bg-zinc-800">
                {logs.map(log => (
                  <div key={log.id} className="relative pl-8">
                    <div className="absolute left-0 top-1.5 w-5 h-5 bg-zinc-900 border-2 border-zinc-700 rounded-full flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                    </div>
                    <div className="text-xs font-mono text-zinc-500 mb-1">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </div>
                    <div className="text-sm font-bold text-zinc-200">{log.event}</div>
                    <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{log.details}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
